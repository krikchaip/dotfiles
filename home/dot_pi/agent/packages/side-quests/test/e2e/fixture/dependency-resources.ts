import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { fixtureCommand } from "./version-resources.ts";

export const DEPENDENCY_EXTENSION = "side-quests-dependency-extension";
export const DEPENDENCY_PACKAGE = "side-quests-dependency-fixture";

/**
 * Serves authored npm generations with real hoisted dependencies on loopback.
 */
export async function startDependencyRegistry(
  harness: E2EHarness,
  resource: "extensions" | "skills" = "extensions",
): Promise<string[]> {
  const root = join(harness.workDirectory, "dependency-fixtures");
  const packages = new Map<string, Record<string, unknown>>();
  const tarballs = new Map<string, Buffer>();
  const marker = join(harness.stateDirectory, "dependency-versions.txt");
  for (const name of [DEPENDENCY_PACKAGE, DEPENDENCY_EXTENSION]) {
    const manifests: Record<string, unknown> = {};
    for (const version of ["1.0.0", "2.0.0"]) {
      const directory = join(root, name, version);
      const pkg = join(directory, "package");
      mkdirSync(pkg, { recursive: true });
      const manifest = {
        name,
        version,
        ...(name === DEPENDENCY_PACKAGE
          ? { main: "index.js" }
          : {
              dependencies: { [DEPENDENCY_PACKAGE]: version },
              pi:
                resource === "extensions"
                  ? { extensions: ["index.ts"] }
                  : { skills: ["skills"] },
            }),
      };
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
      if (name === DEPENDENCY_PACKAGE) {
        writeFileSync(
          join(pkg, "index.js"),
          `exports.version = ${JSON.stringify(version)};\n`,
        );
      } else if (resource === "extensions") {
        writeFileSync(
          join(pkg, "index.ts"),
          [
            'import { appendFileSync } from "node:fs";',
            `import { version } from ${JSON.stringify(DEPENDENCY_PACKAGE)};`,
            `export default () => appendFileSync(${JSON.stringify(marker)},`,
            '(process.env.PI_SIDE_QUESTS_CHILD_ID ? "child:" : "parent:") + version + "\\n");',
          ].join("\n"),
        );
      } else {
        const skill = join(pkg, "skills", "dependency-skill");
        mkdirSync(skill, { recursive: true });
        writeFileSync(
          join(skill, "SKILL.md"),
          `---\nname: dependency-skill\ndescription: Dependency skill ${version}\n---\nRun ./version.cjs to read the installed dependency version.\n`,
        );
        writeFileSync(
          join(skill, "version.cjs"),
          `console.log(require(${JSON.stringify(DEPENDENCY_PACKAGE)}).version);\n`,
        );
      }
      const path = `/${name}-${version}.tgz`;
      const tarball = join(directory, "fixture.tgz");
      fixtureCommand(["tar", "-czf", tarball, "-C", directory, "package"]);
      tarballs.set(path, readFileSync(tarball));
      manifests[version] = { ...manifest, dist: { tarball: path } };
    }
    packages.set(name, manifests);
  }
  let registry = "";
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "";
    const versions = packages.get(path.slice(1));
    if (versions) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: path.slice(1),
          "dist-tags": { latest: "2.0.0" },
          versions: Object.fromEntries(
            Object.entries(versions).map(([version, manifest]) => {
              const pkg = manifest as { dist: { tarball: string } };
              return [
                version,
                { ...pkg, dist: { tarball: registry + pkg.dist.tarball } },
              ];
            }),
          ),
        }),
      );
      return;
    }
    const tarball = tarballs.get(path);
    response.statusCode = tarball ? 200 : 404;
    response.end(tarball ?? "not found");
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
    throw new Error("Dependency registry did not bind to loopback.");
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
