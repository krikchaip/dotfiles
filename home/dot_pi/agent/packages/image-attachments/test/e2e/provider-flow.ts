import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const requests: unknown[] = [];
let responseSequence = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dataImages(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.startsWith("data:image/")) found.push(node);
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
}

function textValues(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if ((key === "text" || key === "content") && typeof child === "string") {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(value);
  return found;
}

function response(): Response {
  responseSequence += 1;
  const text = `IMAGE_PROVIDER_RESPONSE_${responseSequence}`;
  const chunks = [
    {
      id: `image-response-${responseSequence}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    },
    {
      id: `image-response-${responseSequence}`,
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
    return response();
  },
});

try {
  const imagePath = join(runDirectory, "fixture.png");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(imagePath, Buffer.from(pngBase64, "base64"));
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");

  const harness = await PiTuiHarness.start({
    name: "image-provider-flow",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/provider.ts",
      "packages/image-attachments",
    ],
    model: "image-attachments-e2e/vision",
    persistSession: true,
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });

  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendLiteral(" inspect the exact pixel");
  await harness.sendKeys("Enter");
  await harness.waitFor("IMAGE_PROVIDER_RESPONSE_1");
  await harness.waitUntil("first provider request", () => requests.length === 1);

  const firstImages = dataImages(requests[0]);
  const firstTexts = textValues(requests[0]);
  assert(firstImages.length === 1, `Expected one first-request image, got ${firstImages.length}.`);
  assert(
    firstImages[0] === `data:image/png;base64,${pngBase64}`,
    "First provider request changed the image bytes or MIME type.",
  );
  assert(
    firstTexts.some((text) => text.includes("inspect the exact pixel")),
    `First provider request omitted prompt text: ${JSON.stringify(firstTexts)}.`,
  );

  const submittedView = await harness.capture();
  assert(submittedView.includes("Attached [#image 1]"), "Submitted image frame label is missing.");

  await harness.submit("reuse [#image 1] and [#image 1]");
  await harness.waitFor("IMAGE_PROVIDER_RESPONSE_2");
  await harness.waitUntil("second provider request", () => requests.length === 2);
  const secondImages = dataImages(requests[1]);
  assert(
    secondImages.length === 1,
    `Repeated placeholder must deduplicate to one provider image, got ${secondImages.length}.`,
  );
  assert(
    secondImages[0] === `data:image/png;base64,${pngBase64}`,
    "Historical image reference did not restore the original bytes.",
  );

  await harness.finish();

  const sessionFiles = Array.from(
    new Bun.Glob("**/*.jsonl").scanSync({ cwd: harness.stateDirectory, absolute: true }),
  );
  assert(sessionFiles.length === 1, `Expected one session file, got ${sessionFiles.length}.`);
  const entries = readFileSync(sessionFiles[0]!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const serialized = JSON.stringify(entries);
  assert(serialized.includes("inspect the exact pixel"), "Session omitted the first prompt.");
  assert(serialized.includes("reuse [#image 1] and [#image 1]"), "Session omitted the repeated reference.");
  assert(
    serialized.split(pngBase64).length - 1 === 1,
    "Session must persist image bytes once instead of duplicating historical references.",
  );

  console.log(
    "PASS image-attachments provider E2E: paste, submit, exact image bytes, submitted rendering, repeated reference dedupe, and session persistence",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
