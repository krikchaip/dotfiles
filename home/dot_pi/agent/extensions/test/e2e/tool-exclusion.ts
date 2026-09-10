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
function responseEvents(text: string): string {
  return [
    { type: "text_start", contentIndex: 0 },
    { type: "text_delta", contentIndex: 0, delta: text },
    { type: "text_end", contentIndex: 0, content: text },
    { type: "done", reason: "stop", usage },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

let requestCount = 0;
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/messages") {
      return new Response("Not found", { status: 404 });
    }
    requestCount += 1;
    writeFileSync(capturePath, await request.text());
    const responseText =
      requestCount === 1 ? "TOOL_EXCLUSION_READY" : "TOOL_EXCLUSION_DONE";
    return new Response(responseEvents(responseText), {
      headers: { "content-type": "text/event-stream" },
    });
  },
});

const harness = await PiTuiHarness.start({
  name: "tool-exclusion",
  root,
  runDirectory,
  extensions: [
    "extensions/tool-exclusion.ts",
    "extensions/test/e2e/fixture/tool-exclusion-provider.ts",
  ],
  model: "tool-exclusion-e2e/fake",
  settings: {
    excludeTools: ["mcp__github*", "literal\\*", "exact_name"],
  },
  environment: { PI_E2E_TOOL_EXCLUSION_BASE_URL: server.url.toString() },
});

try {
  writeFileSync(
    join(harness.stateDirectory, "settings.json"),
    JSON.stringify({ excludeTools: ["still_available"] }),
  );

  await harness.submit("Register a late tool.");
  await harness.waitFor("TOOL_EXCLUSION_READY");
  await harness.submit("Describe the available tools.");
  await harness.waitFor("TOOL_EXCLUSION_DONE");
  await harness.waitUntil(
    "second provider payload capture",
    () => requestCount === 2 && existsSync(capturePath),
  );

  const payload = JSON.parse(readFileSync(capturePath, "utf8")) as {
    context: { tools: Array<{ name: string }> };
  };
  const activeToolNames = new Set(payload.context.tools.map((tool) => tool.name));

  for (const name of [
    "mcp__github",
    "mcp__github__search",
    "mcp__github__late",
    "literal*",
    "exact_name",
  ]) {
    harness.assert(
      !activeToolNames.has(name),
      `Excluded tool reached the provider payload: ${name}`,
    );
  }
  for (const name of [
    "MCP__GITHUB",
    "prefix_exact_name",
    "exact_name_suffix",
    "literalX",
    "still_available",
  ]) {
    harness.assert(
      activeToolNames.has(name),
      `Unexcluded tool was removed from the provider payload: ${name}`,
    );
  }
  await harness.finish();
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
