import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = join(runDirectory, "provider-payload.json");
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function responseEvents(): string {
  return [
    { type: "text_start", contentIndex: 0 },
    { type: "text_delta", contentIndex: 0, delta: "TOOL_OVERRIDE_READY" },
    { type: "text_end", contentIndex: 0, content: "TOOL_OVERRIDE_READY" },
    { type: "done", reason: "stop", usage },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/messages") {
      return new Response("Not found", { status: 404 });
    }
    writeFileSync(capturePath, await request.text());
    return new Response(responseEvents(), {
      headers: { "content-type": "text/event-stream" },
    });
  },
});

const harness = await PiTuiHarness.start({
  name: "tool-exclusion-cli-override",
  root,
  runDirectory,
  extensions: [
    "extensions/tool-exclusion.ts",
    "extensions/test/e2e/fixture/tool-exclusion-provider.ts",
  ],
  model: "tool-exclusion-e2e/fake",
  cliArguments: ["--tools", "mcp__github,still_available"],
  settings: { excludeTools: ["mcp__*"] },
  environment: { PI_E2E_TOOL_EXCLUSION_BASE_URL: server.url.toString() },
});

try {
  await harness.submit("Describe the available tools.");
  await harness.waitFor("TOOL_OVERRIDE_READY");
  await harness.waitUntil("provider payload capture", () =>
    existsSync(capturePath),
  );

  const payload = JSON.parse(readFileSync(capturePath, "utf8")) as {
    context: { tools: Array<{ name: string }> };
  };
  const activeToolNames = new Set(
    payload.context.tools.map((tool) => tool.name),
  );

  for (const name of ["mcp__github", "still_available"]) {
    harness.assert(
      activeToolNames.has(name),
      `Explicit --tools entry was excluded: ${name}`,
    );
  }
  harness.assert(
    !activeToolNames.has("mcp__github__search"),
    "--tools did not remain a strict allowlist.",
  );
  await harness.finish();
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
