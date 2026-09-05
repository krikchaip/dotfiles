import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const requests: unknown[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function providerResponse(): Response {
  const chunks = [
    {
      id: "guard-response",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "IMAGE_SKILL_RESPONSE" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "guard-response",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    requests.push(await request.json());
    return providerResponse();
  },
});

try {
  const imagePath = writeImageFixtures(runDirectory, "guard").get("image/png")!;
  const commandCapturePath = join(runDirectory, "commands.jsonl");
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "image-submit-guards",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/provider.ts",
      "packages/image-attachments",
      "packages/image-attachments/test/e2e/probe.ts",
    ],
    skills: ["packages/image-attachments/test/e2e/fixture/image-e2e-skill/SKILL.md"],
    model: "image-attachments-e2e/vision",
    environment: {
      IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
      IMAGE_ATTACHMENTS_COMMAND_CAPTURE: commandCapturePath,
    },
    settings: {
      quietStartup: false,
      theme: "dark",
      images: { blockImages: true },
      enableSkillCommands: true,
    },
  });
  await harness.waitFor("IMAGE_ATTACHMENTS_E2E_READY");

  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendLiteral(" blocked normal prompt");
  await harness.sendKeys("Enter");
  let pane = await harness.waitFor("Image reading is disabled");
  assert(pane.includes("[#image 1] blocked normal prompt"), "Disabled-image guard lost editor text.");
  assert(requests.length === 0, "Disabled-image guard reached the provider.");

  await harness.sendKeys("C-u");
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendKeys("C-a");
  await harness.sendLiteral("/image-e2e-capture ");
  await harness.sendKeys("Enter");
  pane = await harness.waitFor(`IMAGE_E2E_COMMAND:${imagePath}`);
  assert(!pane.includes("Could not resolve [#image 1]"), "Known command could not resolve its image path.");
  assert(requests.length === 0, "Extension command reached the provider.");

  await harness.submit("/unknown-image-command [#image 1]");
  await harness.waitUntil("unknown slash image guard", async () => {
    const view = await harness.capture();
    return view.includes("Image reading is disabled") &&
      view.includes("/unknown-image-command [#image 1]");
  });
  pane = await harness.capture();
  assert(pane.includes("/unknown-image-command [#image 1]"), "Unknown slash input bypassed editor preservation.");
  assert(requests.length === 0, "Unknown slash input bypassed the image guard.");
  await harness.sendKeys("C-u");

  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendKeys("C-a");
  await harness.sendLiteral("/skill:image-e2e-skill ");
  await harness.sendKeys("Enter");
  await harness.waitFor("IMAGE_SKILL_RESPONSE");
  await harness.waitUntil("one skill provider request", () => requests.length === 1);
  const serialized = JSON.stringify(requests[0]);
  assert(serialized.includes(imagePath), "Skill expansion omitted the resolved source image path.");
  assert(!serialized.includes("[#image 1]"), "Skill provider payload retained the image placeholder.");
  assert(!serialized.includes("data:image/"), "Skill command sent image bytes while images were blocked.");

  await harness.finish();
  console.log(
    "PASS image-attachments guard E2E: disabled normal and unknown submissions block; extension and skill commands receive paths",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
