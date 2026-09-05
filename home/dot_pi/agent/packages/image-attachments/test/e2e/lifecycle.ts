import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
let responseSequence = 0;
const requests: unknown[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(): Response {
  responseSequence += 1;
  const text = `IMAGE_LIFECYCLE_RESPONSE_${responseSequence}`;
  const chunks = [
    {
      id: `lifecycle-${responseSequence}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    },
    {
      id: `lifecycle-${responseSequence}`,
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

function countImages(value: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if ((node as { type?: string }).type === "image") count += 1;
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return count;
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

const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
const imagePath = writeImageFixtures(runDirectory, "lifecycle").get("image/png")!;
const extensions = [
  "packages/image-attachments/test/e2e/provider.ts",
  "packages/image-attachments",
  "packages/image-attachments/test/e2e/probe.ts",
];

async function restartBranch(): Promise<void> {
  const first = await PiTuiHarness.start({
    name: "image-lifecycle-restart-first",
    root,
    runDirectory,
    extensions,
    model: "image-attachments-e2e/gpt-vision",
    persistSession: true,
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });
  await first.waitFor("IMAGE_ATTACHMENTS_E2E_READY");
  await first.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await first.waitFor("[#image 1]");
  await first.sendLiteral(" persist across restart");
  await first.sendKeys("Enter");
  await first.waitFor("IMAGE_LIFECYCLE_RESPONSE_1");
  await first.finish();

  const sessionFiles = Array.from(
    new Bun.Glob("**/*.jsonl").scanSync({ cwd: first.stateDirectory, absolute: true }),
  );
  assert(sessionFiles.length === 1, `Expected one restart session, got ${sessionFiles.length}.`);

  const second = await PiTuiHarness.start({
    name: "image-lifecycle-restart-second",
    root,
    runDirectory,
    extensions,
    model: "image-attachments-e2e/gpt-vision",
    persistSession: true,
    cliArguments: ["--session", sessionFiles[0]!],
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });
  await second.waitFor("persist across restart");
  await second.submit("reuse [#image 1] after restart");
  await second.waitFor("IMAGE_LIFECYCLE_RESPONSE_2");
  assert(countImages(requests[1]) === 1, "Restarted session did not restore submitted image bytes.");
  await second.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await second.waitFor("[#image 2]");
  await second.finish();
  console.log("PASS image-attachments lifecycle restart branch");
}

async function treeBranch(): Promise<void> {
  const commandCapture = join(runDirectory, "tree-command.jsonl");
  const harness = await PiTuiHarness.start({
    name: "image-lifecycle-tree",
    root,
    runDirectory,
    extensions,
    model: "image-attachments-e2e/vision",
    persistSession: true,
    environment: {
      IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
      IMAGE_ATTACHMENTS_COMMAND_CAPTURE: commandCapture,
    },
    settings: { quietStartup: false, theme: "dark", branchSummary: { skipPrompt: true } },
  });
  const treeResponse = responseSequence + 1;
  await harness.submit("tree lifecycle anchor");
  await harness.waitFor(`IMAGE_LIFECYCLE_RESPONSE_${treeResponse}`);
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendKeys("C-a");
  await harness.sendLiteral("/image-e2e-capture ");
  await harness.sendKeys("Enter");
  await harness.waitUntil("tree draft command", () => existsSync(commandCapture));

  await harness.submit("/tree");
  await harness.waitFor("Session Tree");
  await harness.sendKeys("Up", "Enter");
  await harness.waitFor("Navigated to selected point", 10_000);
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  const pane = await harness.waitFor("[#image 1]");
  assert(!pane.includes("2 images attached"), "Tree navigation retained the stale draft attachment.");
  await harness.finish();
  console.log("PASS image-attachments lifecycle /tree branch");
}

async function compactionBranch(): Promise<void> {
  const commandCapture = join(runDirectory, "compact-command.jsonl");
  const harness = await PiTuiHarness.start({
    name: "image-lifecycle-compact",
    root,
    runDirectory,
    extensions,
    model: "image-attachments-e2e/vision",
    persistSession: true,
    environment: {
      IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
      IMAGE_ATTACHMENTS_COMMAND_CAPTURE: commandCapture,
    },
    settings: {
      quietStartup: false,
      theme: "dark",
      compaction: { reserveTokens: 1_000, keepRecentTokens: 1 },
    },
  });
  let expectedResponse = responseSequence + 1;
  await harness.submit("compaction lifecycle first turn");
  await harness.waitFor(`IMAGE_LIFECYCLE_RESPONSE_${expectedResponse}`);
  expectedResponse = responseSequence + 1;
  await harness.submit("compaction lifecycle second turn");
  await harness.waitFor(`IMAGE_LIFECYCLE_RESPONSE_${expectedResponse}`);
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendKeys("C-a");
  await harness.sendLiteral("/image-e2e-capture ");
  await harness.sendKeys("Enter");
  await harness.waitUntil("compaction draft command", () => existsSync(commandCapture));

  await harness.submit("/compact");
  await harness.waitFor("Compacted from", 15_000);
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  const pane = await harness.waitFor("[#image 1]");
  assert(!pane.includes("2 images attached"), "Compaction retained the stale draft attachment.");
  await harness.finish();

  const sessionFiles = Array.from(
    new Bun.Glob("**/*.jsonl").scanSync({ cwd: harness.stateDirectory, absolute: true }),
  );
  assert(sessionFiles.length === 1, "Compaction branch did not persist one session.");
  assert(readFileSync(sessionFiles[0]!, "utf8").includes('"type":"compaction"'), "No compaction entry persisted.");
  console.log("PASS image-attachments lifecycle compaction branch");
}

const branches = [
  ["restart", restartBranch],
  ["tree", treeBranch],
  ["compaction", compactionBranch],
] as const;
const branchArgument = process.argv.find((arg) => arg.startsWith("--branch="));
const requestedBranch = branchArgument?.slice("--branch=".length);
const selectedBranches = requestedBranch
  ? branches.filter(([name]) => name === requestedBranch)
  : branches;
if (selectedBranches.length === 0) {
  throw new Error(`Unknown lifecycle branch: ${requestedBranch}.`);
}
const branchFailures: string[] = [];

try {
  for (const [name, branch] of selectedBranches) {
    try {
      await branch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      branchFailures.push(`${name}: ${message}`);
      console.error(`RED image-attachments lifecycle ${name} branch: ${message}`);
    }
  }

  if (branchFailures.length > 0) {
    throw new Error(`Image lifecycle branch failures:\n${branchFailures.join("\n")}`);
  }
  console.log(
    `PASS image-attachments lifecycle E2E: ${selectedBranches.map(([name]) => name).join(", ")}`,
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
