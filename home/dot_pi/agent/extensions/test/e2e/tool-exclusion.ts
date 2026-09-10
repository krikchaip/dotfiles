import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = join(runDirectory, "provider-context.json");

const harness = await PiTuiHarness.start({
  name: "tool-exclusion",
  root,
  runDirectory,
  extensions: [
    "extensions/test/e2e/fixture/tool-exclusion-provider.ts",
    "extensions/tool-exclusion.ts",
  ],
  model: "tool-exclusion-e2e/fake",
  settings: { excludeTools: ["mcp__github"] },
  environment: { PI_E2E_TOOL_EXCLUSION_CAPTURE: capturePath },
});

try {
  await harness.submit("Describe the available tools.");
  await harness.waitFor("TOOL_EXCLUSION_DONE");
  await harness.waitUntil("provider context capture", () => existsSync(capturePath));

  const payload = readFileSync(capturePath, "utf8");
  harness.assert(
    !payload.includes("mcp__github"),
    "Excluded namespace-proxy tool reached the provider payload",
  );
  harness.assert(
    payload.includes("mcp__still_available"),
    "Unexcluded namespace-proxy tool was removed from the provider payload",
  );
  await harness.finish();
} finally {
  await cleanupRun(runDirectory);
}
