import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

async function finish(harness: PiTuiHarness): Promise<void> {
  try {
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

try {
  const capturePath = `${runDirectory}/dot-continue-provider.json`;
  const harness = await PiTuiHarness.start({
    name: "dot-continue",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/dot-continue.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify([
        "E2E FIRST RESPONSE",
        "E2E SECOND RESPONSE",
      ]),
    },
  });

  await harness.submit("Start a deterministic turn");
  await harness.waitFor("E2E FIRST RESPONSE");
  await harness.submit(".");
  await harness.waitFor("Continuing…");
  await harness.waitFor("E2E SECOND RESPONSE");
  await finish(harness);

  const captures = JSON.parse(readFileSync(capturePath, "utf8"));
  harness.assert(
    captures.length === 2,
    `Expected 2 provider calls, got ${captures.length}`,
  );
  const secondPayload = JSON.stringify(captures[1]);
  harness.assert(
    secondPayload.includes("dot-continue") &&
      secondPayload.includes("continue"),
    "The second provider call lacks the hidden continue trigger",
  );

  const sessions = [
    ...new Bun.Glob("sessions/**/*.jsonl").scanSync(harness.stateDirectory),
  ];
  harness.assert(
    sessions.length === 1,
    `Expected one session file, got ${sessions.length}`,
  );
  const session = readFileSync(
    `${harness.stateDirectory}/${sessions[0]}`,
    "utf8",
  );
  harness.assert(
    session.includes("E2E FIRST RESPONSE"),
    "Session lost the first response",
  );
  harness.assert(
    session.includes("E2E SECOND RESPONSE"),
    "Session lost the continued response",
  );
  harness.assert(
    !session.includes('"customType":"dot-continue"'),
    "Hidden dot-continue entry remained in session history",
  );

  const empty = await PiTuiHarness.start({
    name: "dot-continue-empty",
    root,
    runDirectory,
    extensions: ["extensions/dot-continue.ts"],
  });
  await empty.submit("   .   ");
  await empty.waitFor("Nothing to continue");
  await finish(empty);

  const retryCapturePath = `${runDirectory}/dot-retry-provider.json`;
  const retry = await PiTuiHarness.start({
    name: "dot-continue-retry",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/dot-continue-probe.ts",
      "extensions/dot-continue.ts",
    ],
    model: "dot-continue-e2e/fake",
    persistSession: true,
    environment: {
      PI_E2E_DOT_CAPTURE: retryCapturePath,
      PI_E2E_DOT_RESPONSES: JSON.stringify([
        { text: "E2E RETRY FAILURE", error: true },
        { text: "E2E RETRY SUCCESS" },
        { text: "E2E REPEAT SUCCESS", delayMs: 700 },
      ]),
    },
  });
  await retry.waitFor("DOT CONTINUE PROBE READY");
  await retry.submit("Create an error that can be retried");
  await retry.waitFor("E2E RETRY FAILURE");
  await retry.submit("/dot-label-leaf");
  await retry.waitFor("DOT LABELLED");
  await retry.submit(".");
  await retry.waitFor("Retrying…");
  await retry.waitFor("E2E RETRY SUCCESS");
  await retry.submit(".");
  await retry.waitFor("Continuing…");
  await retry.submit(".");
  await retry.waitFor("Dot continue already pending");
  await retry.waitFor("E2E REPEAT SUCCESS");
  await finish(retry);

  const retryCaptures = JSON.parse(readFileSync(retryCapturePath, "utf8"));
  retry.assert(
    retryCaptures.length === 3,
    `Expected 3 retry provider calls, got ${retryCaptures.length}`,
  );
  const expectedBaselineFailures: string[] = [];
  const retryPayload = JSON.stringify(retryCaptures[1]);
  retry.assert(
    retryPayload.includes("dot-continue"),
    "Retry provider context lacks the hidden retry trigger",
  );
  retry.assert(
    retryPayload.includes("Create an error that can be retried"),
    "Retry provider context lost the original user request",
  );
  if (retryPayload.includes("E2E RETRY FAILURE")) {
    expectedBaselineFailures.push(
      "[context/retry-error] retry provider retained the failed assistant response",
    );
  }
  const repeatPayload = JSON.stringify(retryCaptures[2]);
  retry.assert(
    repeatPayload.includes("dot-continue"),
    "Repeated provider context lacks the hidden continue trigger",
  );
  retry.assert(
    repeatPayload.includes("E2E RETRY SUCCESS"),
    "Repeated provider context lost the successful retry response",
  );
  if (repeatPayload.includes("E2E RETRY FAILURE")) {
    expectedBaselineFailures.push(
      "[context/repeated-continue] repeated provider retained the failed assistant response",
    );
  }

  const retrySessions = [
    ...new Bun.Glob("sessions/**/*.jsonl").scanSync(retry.stateDirectory),
  ];
  retry.assert(
    retrySessions.length === 1,
    `Expected one retry session file, got ${retrySessions.length}`,
  );
  const retrySession = readFileSync(
    `${retry.stateDirectory}/${retrySessions[0]}`,
    "utf8",
  );
  const retryEntries = retrySession
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  retry.assert(
    !retrySession.includes("E2E RETRY FAILURE"),
    "Failed assistant entry remained in the rewritten session",
  );
  retry.assert(
    !retrySession.includes("DOT_ERROR_LABEL"),
    "Label linked to the deleted assistant error remained in session",
  );
  retry.assert(
    !retrySession.includes('"customType":"dot-continue"'),
    "A retry or repeated hidden trigger remained in session history",
  );
  const entryIds = new Set(
    retryEntries
      .map((entry) => entry.id)
      .filter((id) => typeof id === "string"),
  );
  const dangling = retryEntries.filter(
    (entry) =>
      typeof entry.parentId === "string" && !entryIds.has(entry.parentId),
  );
  if (dangling.length > 0) {
    expectedBaselineFailures.push(
      `[graph/dangling-parent] session rewrite left dangling parent link(s): ${JSON.stringify(dangling)}`,
    );
  }
  const userEntry = retryEntries.find(
    (entry) => entry.type === "message" && entry.message?.role === "user",
  );
  const retrySuccess = retryEntries.find((entry) =>
    JSON.stringify(entry).includes("E2E RETRY SUCCESS"),
  );
  const repeatSuccess = retryEntries.find((entry) =>
    JSON.stringify(entry).includes("E2E REPEAT SUCCESS"),
  );
  if (retrySuccess?.parentId !== userEntry?.id) {
    expectedBaselineFailures.push(
      "[graph/reparent-survivor] retry success was not promoted to the deleted error's parent",
    );
  }
  if (repeatSuccess?.parentId !== retrySuccess?.id) {
    expectedBaselineFailures.push(
      "[graph/reparent-repeat] repeated success was not promoted to the prior assistant response",
    );
  }
  retry.assert(
    expectedBaselineFailures.length === 0,
    `dot-continue expected baseline failures:\n- ${expectedBaselineFailures.join("\n- ")}`,
  );
  console.log(
    "PASS dot-continue: empty, continue, retry, repeated dot, and session graph integrity",
  );
} finally {
  await cleanupRun(runDirectory);
}
