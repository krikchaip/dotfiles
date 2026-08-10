import { join } from "node:path";
import { assertExactKeys } from "./theme-contract.ts";
import { buildInventory, fetchSourceText } from "./omp-source.ts";
import { readUpstreamManifest } from "./upstream-config.ts";

const packageDir = join(import.meta.dir, "..");
const manifest = await readUpstreamManifest(join(packageDir, "upstream.json"));
const [upstreamIndex, upstreamLicense, localLicense] = await Promise.all([
  fetchSourceText(manifest, manifest.indexPath),
  fetchSourceText(manifest, "LICENSE"),
  Bun.file(join(packageDir, "LICENSE")).text(),
]);

const upstreamNames = buildInventory(upstreamIndex, manifest).map(({ name }) => name);
assertExactKeys(manifest.themes, upstreamNames, "upstream theme inventory");
if (localLicense !== upstreamLicense) {
  throw new Error("LICENSE does not exactly match the license at the pinned upstream commit");
}

console.log(`Verified inventory and license against pinned OMP commit ${manifest.commit}.`);
