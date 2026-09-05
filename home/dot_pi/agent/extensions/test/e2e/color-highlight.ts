const script = `${import.meta.dir}/executable_color-highlight.expect`;
const processHandle = Bun.spawn(["expect", script], {
  env: {
    ...process.env,
    PI_E2E_EXPECT_VERSION: process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4",
  },
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await processHandle.exited;
if (exitCode !== 0) {
  throw new Error(`color-highlight E2E exited with status ${exitCode}`);
}
