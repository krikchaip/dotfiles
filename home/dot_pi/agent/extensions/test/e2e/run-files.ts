import { resolve } from "node:path";

export async function runFiles(
  directory: string,
  files: string[],
  jobs = files.length,
): Promise<void> {
  const failures: string[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const file = files[nextIndex++];
      if (!file) return;
      const process = Bun.spawn(["bun", resolve(directory, file)], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      const status = await process.exited;
      if (status !== 0) failures.push(`${file} (${status})`);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(jobs, files.length) }, () => worker()),
  );
  if (failures.length > 0) {
    throw new Error(`E2E files failed: ${failures.join(", ")}`);
  }
}
