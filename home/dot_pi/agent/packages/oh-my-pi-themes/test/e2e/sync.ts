import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { OMP_REQUIRED_COLOR_TOKENS } from "../../scripts/theme-contract.ts";

const packageRoot = resolve(import.meta.dir, "../..");
const preload = join(import.meta.dir, "fixture/sync-preload.ts");
const runDirectory = `/tmp/oh-my-pi-themes-sync-e2e-${process.pid}`;
const commit = "a".repeat(40);
const sourceManifest = {
  repository: "https://github.com/example/themes",
  commit,
  indexPath: "index.ts",
  themesPath: "themes",
  rootThemes: [],
  themes: ["old-snapshot"],
};
const upstreamColors = Object.fromEntries(
  OMP_REQUIRED_COLOR_TOKENS.map((token) => [token, "#123456"]),
);
upstreamColors.selectedBg = "#11223388";
upstreamColors.thinkingXhigh = "$intenseThinking";
const upstreamTheme = JSON.stringify({
  name: "sample",
  vars: { intenseThinking: "#445566" },
  colors: upstreamColors,
});
const indexSource = [
  'import sample from "./sample.json" with { type: "json" };',
  "",
  "export const defaultThemes = {",
  "  sample: sample,",
  "};",
].join("\n");
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "http-error") {
      return new Response("missing", { status: 404 });
    }
    if (url.pathname === "/index") return new Response(indexSource);
    if (url.pathname === "/theme") {
      return new Response(
        url.searchParams.get("mode") === "invalid-json" ? "{" : upstreamTheme,
      );
    }
    if (url.pathname === "/license") {
      return new Response(
        url.searchParams.get("mode") === "invalid-license"
          ? "Apache License\n"
          : "MIT License\n\nFake upstream fixture.\n",
      );
    }
    return new Response("missing fixture", { status: 404 });
  },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeCopy(name: string): string {
  const path = join(runDirectory, name);
  cpSync(packageRoot, path, { recursive: true });
  writeFileSync(
    join(path, "upstream.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
  );
  return path;
}

function digest(path: string): string {
  const hash = createHash("sha256");
  const visit = (current: string, relative: string) => {
    for (const name of readdirSync(current).sort()) {
      if (name.startsWith(".themes-sync-")) continue;
      const absolute = join(current, name);
      const next = relative ? `${relative}/${name}` : name;
      const stat = Bun.file(absolute);
      if (existsSync(absolute) && readdirSyncSafe(absolute))
        visit(absolute, next);
      else {
        hash.update(next);
        hash.update(readFileSync(absolute));
      }
    }
  };
  visit(path, "");
  return hash.digest("hex");
}

function readdirSyncSafe(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

async function runUpstreamCommand(
  path: string,
  script: "sync.ts" | "check-upstream.ts",
  extraEnvironment: Record<string, string> = {},
): Promise<{ status: number; output: string }> {
  const processHandle = Bun.spawn(
    ["bun", "--preload", preload, join(path, "scripts", script)],
    {
      cwd: path,
      env: {
        ...process.env,
        PI_E2E_UPSTREAM_BASE: upstream.url.href,
        ...extraEnvironment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { status, output: `${stdout}${stderr}` };
}

function runSync(
  path: string,
  extraEnvironment: Record<string, string> = {},
): Promise<{ status: number; output: string }> {
  return runUpstreamCommand(path, "sync.ts", extraEnvironment);
}

async function successScenario(): Promise<void> {
  const path = makeCopy("success");
  const result = await runSync(path);
  assert(result.status === 0, `Sync success fixture failed:\n${result.output}`);
  const files = readdirSync(join(path, "themes"));
  assert(
    JSON.stringify(files) === JSON.stringify(["sample.json"]),
    `Sync did not atomically replace theme inventory: ${files}`,
  );
  const generated = JSON.parse(
    readFileSync(join(path, "themes/sample.json"), "utf8"),
  );
  assert(generated.name === "sample", "Synced theme has the wrong name");
  assert(
    generated.colors.selectedBg === "#112233" &&
      generated.colors.scrollbarThumb === "#112233",
    "Generated scrollbar fallback did not use the normalized selection color",
  );
  assert(
    generated.vars.intenseThinking === "#445566" &&
      generated.colors.thinkingXhigh === "intenseThinking" &&
      generated.colors.thinkingMax === "intenseThinking",
    "Generated maximum-thinking fallback did not preserve the upstream variable",
  );
  const manifest = JSON.parse(
    readFileSync(join(path, "upstream.json"), "utf8"),
  );
  assert(
    JSON.stringify(manifest.themes) === JSON.stringify(["sample"]),
    "Synced manifest inventory changed",
  );
  assert(
    readFileSync(join(path, "README.md"), "utf8").includes(commit),
    "README provenance was not updated",
  );
  assert(
    readFileSync(join(path, "LICENSE"), "utf8").includes(
      "Fake upstream fixture",
    ),
    "License was not updated",
  );
  assert(
    !readdirSync(path).some((name) => name.startsWith(".themes-sync-")),
    "Successful sync left a temp directory",
  );
  const upstreamCheck = await runUpstreamCommand(path, "check-upstream.ts");
  assert(
    upstreamCheck.status === 0 &&
      upstreamCheck.output.includes(
        `Verified inventory and license against pinned OMP commit ${commit}.`,
      ),
    `Public upstream check failed after sync:\n${upstreamCheck.output}`,
  );
  const firstDigest = digest(path);
  const rerun = await runSync(path);
  assert(rerun.status === 0, `Idempotent sync rerun failed:\n${rerun.output}`);
  assert(
    digest(path) === firstDigest,
    "Idempotent sync rerun changed generated package bytes",
  );
  console.log(
    "PASS theme sync success and idempotent rerun through local fetch boundary",
  );
}

async function preinstallFailureScenario(
  mode: "invalid-json" | "http-error" | "invalid-license",
): Promise<void> {
  const path = makeCopy(mode);
  const before = digest(path);
  const result = await runSync(path, { PI_E2E_FETCH_MODE: mode });
  assert(result.status !== 0, `${mode} unexpectedly succeeded`);
  assert(
    digest(path) === before,
    `${mode} changed the package snapshot before install`,
  );
  assert(
    !readdirSync(path).some((name) => name.startsWith(".themes-sync-")),
    `${mode} left a temp directory`,
  );
  console.log(`PASS theme sync ${mode} leaves snapshot unchanged`);
}

async function lockAndRecoveryScenario(): Promise<void> {
  const locked = makeCopy("locked");
  const lock = join(locked, ".themes-sync-live");
  mkdirSync(lock);
  writeFileSync(
    join(lock, ".sync-state.json"),
    `${JSON.stringify({ pid: process.pid })}\n`,
  );
  const before = digest(locked);
  const lockResult = await runSync(locked);
  assert(
    lockResult.status !== 0 &&
      lockResult.output.includes("another theme sync is running"),
    "Live sync lock was not rejected",
  );
  assert(
    digest(locked) === before,
    "Live sync lock changed the package snapshot",
  );

  const recovered = makeCopy("recovered");
  const interrupted = join(recovered, ".themes-sync-stale");
  const backup = join(interrupted, "previous-themes");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "old.json"), "OLD COMPLETE SNAPSHOT\n");
  rmSync(join(recovered, "themes"), { recursive: true, force: true });
  mkdirSync(join(recovered, "themes"));
  writeFileSync(
    join(recovered, "themes/new.json"),
    "INTERRUPTED NEW SNAPSHOT\n",
  );
  writeFileSync(join(interrupted, "upstream.json"), "{}\n");
  writeFileSync(
    join(interrupted, ".sync-state.json"),
    `${JSON.stringify({ pid: 2_147_483_647 })}\n`,
  );
  const recoveryResult = await runSync(recovered, {
    PI_E2E_FETCH_MODE: "invalid-json",
  });
  assert(
    recoveryResult.status !== 0,
    "Recovery continuation unexpectedly completed sync",
  );
  assert(
    readFileSync(join(recovered, "themes/old.json"), "utf8") ===
      "OLD COMPLETE SNAPSHOT\n",
    "Stale recovery did not restore previous themes",
  );
  assert(
    !existsSync(interrupted),
    "Stale recovery left its transaction directory",
  );
  const invalid = makeCopy("invalid-marker");
  const invalidTransaction = join(invalid, ".themes-sync-invalid");
  mkdirSync(invalidTransaction);
  writeFileSync(join(invalidTransaction, ".sync-state.json"), "not-json\n");
  const invalidBefore = digest(invalid);
  const invalidResult = await runSync(invalid);
  assert(
    invalidResult.status !== 0 &&
      invalidResult.output.includes("invalid sync marker"),
    `Invalid interrupted-sync marker returned the wrong diagnostic:\n${invalidResult.output}`,
  );
  assert(
    digest(invalid) === invalidBefore,
    "Invalid sync marker changed active package artifacts",
  );
  console.log(
    "PASS theme sync live lock, stale recovery, and invalid-marker safety",
  );
}

async function transactionalFailureScenario(): Promise<void> {
  const path = makeCopy("transactional-failure");
  const before = digest(path);
  const result = await runSync(path, { PI_E2E_FAIL_STAGED_README: "1" });
  assert(
    result.status !== 0,
    "Injected staged README failure unexpectedly succeeded",
  );
  const remainedAtomic = digest(path) === before;
  const rerun = await runSync(path);
  assert(
    rerun.status === 0,
    `Sync did not recover on rerun after the injected failure:\n${rerun.output}`,
  );
  assert(
    readdirSync(join(path, "themes")).join(",") === "sample.json" &&
      JSON.parse(readFileSync(join(path, "upstream.json"), "utf8")).themes.join(
        ",",
      ) === "sample" &&
      readFileSync(join(path, "README.md"), "utf8").includes(commit) &&
      readFileSync(join(path, "LICENSE"), "utf8").includes(
        "Fake upstream fixture",
      ),
    "Rerun after the injected failure did not recover a consistent new snapshot",
  );
  assert(
    remainedAtomic,
    "[KNOWN RED] post-theme README install failure leaves a mixed package snapshot",
  );
  console.log(
    "PASS resolved regression: theme sync rolls back all artifacts after post-theme failure",
  );
}

try {
  mkdirSync(runDirectory, { recursive: true });
  await Promise.all([
    successScenario(),
    preinstallFailureScenario("invalid-json"),
    preinstallFailureScenario("http-error"),
    preinstallFailureScenario("invalid-license"),
    lockAndRecoveryScenario(),
  ]);
  if (process.env.PI_E2E_KNOWN_REGRESSION === "transactional-sync") {
    await transactionalFailureScenario();
  }
} finally {
  upstream.stop(true);
  if (process.env.KEEP_E2E_ARTIFACTS !== "1")
    rmSync(runDirectory, { recursive: true, force: true });
  else console.log(`ARTIFACTS=${runDirectory}`);
}
