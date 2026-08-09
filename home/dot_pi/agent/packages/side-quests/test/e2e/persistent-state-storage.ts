import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

type Json = Readonly<Record<string, unknown>>;
type StoragePhase = "response" | "terminal";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function json(path: string): Json {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  expect(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `Expected a JSON object at ${path}`,
  );
  return value as Json;
}

function string(value: unknown, name: string): string {
  expect(typeof value === "string" && value.length > 0, `Missing ${name}`);
  return value;
}

function privateDirectory(path: string): void {
  const mode = statSync(path).mode & 0o777;
  expect(
    mode === 0o700,
    `Expected private 0700 directory ${path}, got ${mode.toString(8)}`,
  );
}

function privateFile(path: string): void {
  const mode = statSync(path).mode & 0o777;
  expect(
    mode === 0o600,
    `Expected private 0600 file ${path}, got ${mode.toString(8)}`,
  );
}

function directories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

export function assertManagedStorage(
  phase: StoragePhase,
  stateDirectory: string,
  paneId: string,
): void {
  const storeRoot = join(stateDirectory, "side-quests");
  const sessionRoot = join(storeRoot, "sessions");
  const sessionDirectories = directories(sessionRoot).flatMap(directories);

  expect(
    sessionDirectories.length === 1,
    `Expected one managed child session, found ${sessionDirectories.length}`,
  );

  const sessionDirectory = sessionDirectories.at(0);

  expect(sessionDirectory, "Expected one managed child session directory");

  const sessionFile = join(sessionDirectory, "session.jsonl");
  const manifestFile = join(sessionDirectory, "manifest.json");
  const mailboxDirectory = join(sessionDirectory, "mailbox");
  const requestFile = join(mailboxDirectory, "request.json");
  const responseFile = join(mailboxDirectory, "response.json");

  for (const path of [
    storeRoot,
    sessionRoot,
    sessionDirectory,
    mailboxDirectory,
  ])
    privateDirectory(path);

  for (const path of [sessionFile, manifestFile]) privateFile(path);

  const sessionHeaderLine = readFileSync(sessionFile, "utf8").split("\n")[0];

  expect(sessionHeaderLine, "Managed session file has no header");

  const sessionHeader = JSON.parse(sessionHeaderLine) as Json;
  const manifest = json(manifestFile);
  const parentId = string(manifest.parentId, "manifest parent ID");
  const childId = string(manifest.childId, "manifest child ID");
  const ownerId = string(manifest.ownerId, "manifest owner ID");

  expect(
    sessionHeader.id === childId,
    "Session header child ID does not match manifest",
  );

  expect(
    manifest.sessionPath === realpathSync(sessionFile),
    "Manifest session path is not canonical",
  );

  expect(
    manifest.lifecycle === "interactive",
    "Storage child is not interactive",
  );

  const runtimeDirectory = join(storeRoot, "runtime", parentId);
  const childRuntimeDirectory = join(runtimeDirectory, "children", childId);
  const ownerFile = join(runtimeDirectory, "owner.json");
  const childRuntimeFile = join(childRuntimeDirectory, "child.json");
  const activityFile = join(childRuntimeDirectory, "activity.json");

  for (const path of [
    runtimeDirectory,
    join(runtimeDirectory, "children"),
    childRuntimeDirectory,
  ])
    privateDirectory(path);

  for (const path of [ownerFile, childRuntimeFile, activityFile])
    privateFile(path);

  const owner = json(ownerFile);
  const childRuntime = json(childRuntimeFile);
  const activity = json(activityFile);

  expect(
    owner.parentId === parentId && owner.ownerId === ownerId,
    "Owner state does not match the managed manifest",
  );

  expect(
    Number.isInteger(owner.pid) && typeof owner.windowId === "string",
    "Owner state lacks a live owner process or tmux window",
  );

  expect(
    childRuntime.parentId === parentId && childRuntime.childId === childId,
    "Child runtime state does not match manifest lineage",
  );

  expect(
    childRuntime.paneId === paneId && typeof childRuntime.windowId === "string",
    "Child runtime state does not identify the live tmux pane",
  );

  expect(
    activity.childId === childId && activity.lifecycle === "interactive",
    "Activity state does not match the managed child",
  );

  expect(
    activity.phase === "starting" ||
      activity.phase === "active" ||
      activity.phase === "waiting",
    "Activity state has an invalid phase",
  );

  expect(
    typeof activity.heartbeatAt === "number" &&
      Date.now() - activity.heartbeatAt <= 10_000,
    "Activity state does not have a current heartbeat",
  );

  if (phase === "response") {
    const request = json(requestFile);

    privateFile(requestFile);

    expect(
      request.childId === childId &&
        request.prompt === "Which persistence value should I use?",
      "Request mailbox does not contain the expected correlated request",
    );

    expect(
      activity.pendingRequest === true,
      "Activity state does not report the pending parent request",
    );

    const response = json(responseFile);

    privateFile(responseFile);

    expect(
      response.childId === childId && response.requestId === request.requestId,
      "Response mailbox does not match the child request",
    );

    expect(
      response.prompt === "Use durable-state.",
      "Response mailbox has an unexpected continuation",
    );

    return;
  }

  const terminalFile = join(childRuntimeDirectory, "terminal.json");

  privateFile(terminalFile);

  const terminal = json(terminalFile);

  expect(
    terminal.childId === childId && terminal.kind === "completed",
    "Terminal state does not record child completion",
  );

  expect(
    terminal.response === "Persistence response applied.",
    "Terminal state has an unexpected final response",
  );

  expect(
    !existsSync(requestFile) && !existsSync(responseFile),
    "Accepted mailbox records were not consumed",
  );
}
