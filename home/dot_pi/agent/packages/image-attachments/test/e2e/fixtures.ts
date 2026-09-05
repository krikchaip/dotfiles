import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const imageFixtures = [
  {
    extension: "png",
    mimeType: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
  {
    extension: "jpg",
    mimeType: "image/jpeg",
    base64: readFileSync(join(import.meta.dir, "fixture/matrix.jpg")).toString("base64"),
  },
  {
    extension: "gif",
    mimeType: "image/gif",
    base64: "R0lGODlhAgACAPABAP8AAP///yH5BAAAAAAALAAAAAACAAIAAAIChFEAOw==",
  },
  {
    extension: "webp",
    mimeType: "image/webp",
    base64:
      "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
  },
] as const;

export function writeImageFixtures(directory: string, prefix = "fixture"): Map<string, string> {
  mkdirSync(directory, { recursive: true });
  return new Map(
    imageFixtures.map((fixture) => {
      const path = join(directory, `${prefix}.${fixture.extension}`);
      writeFileSync(path, Buffer.from(fixture.base64, "base64"));
      return [fixture.mimeType, path];
    }),
  );
}
