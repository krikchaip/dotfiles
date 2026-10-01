import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createPortReservation } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const VERSION_PACKAGE = "side-quests-version-fixture";
const versions = ["1.0.0", "2.0.0"] as const;

/**
 * Creates two approved fixture commits only under /tmp and serves them on loopback.
 */
export async function startVersionGitRepository(
  harness: E2EHarness,
): Promise<readonly string[]> {
  const root = mkdtempSync(join(tmpdir(), "side-quests-git-"));
  const repository = join(root, "owner", "repo");
  mkdirSync(repository, { recursive: true });
  harness.onCleanup(async () => rmSync(root, { force: true, recursive: true }));
  fixtureCommand(["git", "init", "-q", repository]);
  for (const version of versions) {
    writeVersionPackage(
      repository,
      version,
      join(harness.stateDirectory, "versions.txt"),
    );
    fixtureCommand(["git", "add", "package.json", "index.ts"], repository);
    fixtureCommand(
      [
        "git",
        "-c",
        "user.name=Side Quests Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        version,
      ],
      repository,
    );
    fixtureCommand(["git", "tag", version], repository);
  }
  const reservation = createPortReservation();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Git fixture port unavailable.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const daemon = spawn(
    "git",
    [
      "daemon",
      "--reuseaddr",
      "--export-all",
      "--verbose",
      "--listen=127.0.0.1",
      `--port=${address.port}`,
      `--base-path=${root}`,
      root,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  harness.onCleanup(async () => {
    if (daemon.exitCode !== null || daemon.signalCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      daemon.once("exit", () => resolve()),
    );
    daemon.kill();
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Git daemon startup timed out.")),
      5_000,
    );
    daemon.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    daemon.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Git daemon exited: ${code}`));
    });
    daemon.stderr.on("data", (data) => {
      if (!String(data).includes("Ready to rumble")) return;
      clearTimeout(timer);
      resolve();
    });
  });
  return versions.map(
    (version) => `git:git://127.0.0.1:${address.port}/owner/repo@${version}`,
  );
}

/**
 * Creates an authored package whose factory records the version actually loaded.
 */
export function writeVersionPackage(
  directory: string,
  version: string,
  marker: string,
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: VERSION_PACKAGE,
      version,
      pi: { extensions: ["index.ts"] },
    }),
  );
  writeFileSync(
    join(directory, "index.ts"),
    [
      'import { appendFileSync } from "node:fs";',
      "export default () => appendFileSync(",
      `  ${JSON.stringify(marker)},`,
      `  (process.env.PI_SIDE_QUESTS_CHILD_ID ? "child:" : "parent:") + ${JSON.stringify(version)} + "\\n",`,
      ");",
    ].join("\n"),
  );
}

/**
 * Runs a fixture command without changing the dotfiles repository or user caches.
 */
export function fixtureCommand(command: string[], cwd?: string): void {
  const result = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`Fixture command failed: ${result.stderr}`);
}

/**
 * Serves two authored npm tarballs on loopback for the real npm/Pi resolver.
 */
export async function startVersionRegistry(
  harness: E2EHarness,
  resource: "extensions" | "skills" = "extensions",
): Promise<string[]> {
  const root = join(harness.workDirectory, "version-fixtures");
  const marker = join(harness.stateDirectory, "versions.txt");
  const tarballs = new Map<string, Buffer>();
  for (const version of versions) {
    const directory = join(root, version);
    writeVersionPackage(join(directory, "package"), version, marker);
    if (resource === "skills") {
      const skillDirectory = join(directory, "package", "skills", "fixture");
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(
        join(directory, "package", "package.json"),
        JSON.stringify({
          name: VERSION_PACKAGE,
          version,
          pi: { skills: ["skills"] },
        }),
      );
      writeFileSync(
        join(skillDirectory, "SKILL.md"),
        `---\nname: fixture\ndescription: Package skill ${version}\n---\nRead ./support.txt for package instructions.\n`,
      );
      writeFileSync(join(skillDirectory, "support.txt"), `SUPPORT ${version}`);
    }
    const tarball = join(root, `${version}.tgz`);
    fixtureCommand(["tar", "-czf", tarball, "-C", directory, "package"]);
    tarballs.set(version, readFileSync(tarball));
  }
  let registry = "";
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0];
    if (path === `/${VERSION_PACKAGE}`) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: VERSION_PACKAGE,
          "dist-tags": { latest: "2.0.0" },
          versions: Object.fromEntries(
            versions.map((version) => [
              version,
              {
                name: VERSION_PACKAGE,
                version,
                dist: { tarball: `${registry}/${version}.tgz` },
              },
            ]),
          ),
        }),
      );
    } else {
      const version = path?.slice(1).replace(".tgz", "") ?? "";
      const tarball = tarballs.get(version);
      response.statusCode = tarball ? 200 : 404;
      response.end(tarball ?? "not found");
    }
  });
  harness.onCleanup(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Registry did not bind to loopback.");
  registry = `http://127.0.0.1:${address.port}`;
  return [
    "npm",
    "--registry",
    registry,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ];
}
