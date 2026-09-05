import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = join(runDirectory, "commands.jsonl");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function captures(): string[] {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

try {
  const sourcePath = writeImageFixtures(runDirectory, "materialize").get("image/png")!;
  const originalBytes = readFileSync(sourcePath);
  const hash = createHash("sha256").update(originalBytes).digest("hex");
  const home = join(runDirectory, "image-materialization-home");
  const expectedPath = join(
    home,
    ".pi",
    "agent",
    "tmp",
    "image-attachments",
    `${hash}.png`,
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Not used", { status: 500 }),
  });

  try {
    const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
    const harness = await PiTuiHarness.start({
      name: "image-materialization",
      root,
      runDirectory,
      extensions: [
        "packages/image-attachments/test/e2e/provider.ts",
        "packages/image-attachments",
        "packages/image-attachments/test/e2e/probe.ts",
      ],
      model: "image-attachments-e2e/vision",
      environment: {
        IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
        IMAGE_ATTACHMENTS_COMMAND_CAPTURE: capturePath,
      },
      settings: { quietStartup: false, theme: "dark" },
    });
    await harness.waitFor("IMAGE_ATTACHMENTS_E2E_READY");

    await harness.sendLiteral(`\x1b[200~${sourcePath}\x1b[201~`);
    await harness.waitFor("[#image 1]");
    rmSync(sourcePath);
    await harness.sendKeys("C-a");
    await harness.sendLiteral("/image-e2e-capture ");
    await harness.sendKeys("Enter");
    await harness.waitUntil(
      "first materialization capture",
      () => captures()[0] === expectedPath,
    );
    assert(existsSync(expectedPath), "Deleted source was not materialized from stored bytes.");
    assert(readFileSync(expectedPath).equals(originalBytes), "Materialized file bytes changed.");
    assert(captures()[0] === expectedPath, "Command did not receive the materialized path.");

    const firstMtime = statSync(expectedPath).mtimeMs;
    await Bun.sleep(20);
    await harness.submit("/image-e2e-capture [#image 1] [#image 1]");
    await harness.waitUntil("second materialization capture", () => captures().length === 2);
    assert(
      captures()[1] === `${expectedPath} ${expectedPath}`,
      "Repeated placeholders did not reuse one stable materialized path.",
    );
    assert(statSync(expectedPath).mtimeMs === firstMtime, "Existing materialized bytes were rewritten.");

    rmSync(join(home, ".pi", "agent", "tmp"), { force: true, recursive: true });
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "tmp"), "block materialization directory\n");
    await harness.submit("/image-e2e-capture [#image 1]");
    const warningPane = await harness.waitFor("Could not resolve [#image 1] to image paths");
    await harness.waitUntil("unresolved command capture", () => captures().length === 3);
    assert(warningPane.includes("submitting unchanged"), "Materialization failure warning is incomplete.");
    assert(captures()[2] === "[#image 1]", "Unresolved command placeholder was changed.");

    await harness.finish();
    console.log(
      "PASS image-attachments materialization E2E: deleted sources materialize once, dedupe paths, and fail safely",
    );
  } finally {
    server.stop(true);
  }
} finally {
  await cleanupRun(runDirectory);
}
