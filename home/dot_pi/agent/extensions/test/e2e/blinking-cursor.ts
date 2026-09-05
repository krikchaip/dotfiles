const script = `${import.meta.dir}/executable_blinking-cursor.expect`;
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
  throw new Error(`blinking-cursor E2E exited with status ${exitCode}`);
}
