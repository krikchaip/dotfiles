// The page tells the user when no agent is listening (sends then only queue) and clears it when
// one returns. Real `serve --detach` (whose output nobody reads) plus a real `wait`.
// PLAYWRIGHT_PKG=/path/to/@playwright/test/index.mjs node test/listener.e2e.mjs
// Optional GRILL_EVIDENCE_DIR saves screenshots.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const server = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const scratch = mkdtempSync(join(tmpdir(), "grill-listener-"));
const env = { ...process.env, GRILL_HOME: join(scratch, "home") };
const evidence = process.env.GRILL_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const cli = (args, input) => execFileSync(process.execPath, [server, ...args], { env, cwd: scratch, encoding: "utf8", input });
const ago = (ms) => new Date(Date.now() - ms);

const { session } = JSON.parse(cli(["new", "--topic", "Listener indicator"]));
const patch = (value) => cli(["patch", "--session", session], JSON.stringify(value));
// Every sign of life minutes old: the agent patched long ago and no wait has run since.
const goQuiet = () => {
  utimesSync(join(session, "state.json"), ago(10 * 60_000), ago(10 * 60_000));
  writeFileSync(join(session, "listener.json"), JSON.stringify({ via: "wait", pid: 1, at: ago(10 * 60_000).toISOString() }));
};
patch({ agent: { status: "waiting", handled: 0 }, questions: [{ id: "q1", round: 1, title: "Pick one", body: "Test the listener indicator.", options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }], rec: { option: "A", why: "Simple." }, status: "open" }] });
goQuiet();
let browser;
let waiter;
try {
  const ready = JSON.parse(cli(["serve", "--session", session, "--detach"]));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const status = () => page.locator("#agent-status").textContent();
  const unheard = () => page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("No agent is listening"), null, { timeout: 8000 });
  const heard = () => page.waitForFunction(() => !document.getElementById("agent-status").textContent.includes("No agent is listening"), null, { timeout: 8000 });
  await page.goto(ready.url);
  await page.locator(".item").first().waitFor();
  await unheard();
  assert.match(await status(), /sends will queue until it resumes/);
  assert.equal(await page.locator("#agent-dot.unheard").count(), 1, "the dot changes too");
  if (evidence) await page.screenshot({ path: join(evidence, "listener-none.png") });

  // A send made now is accepted and queued, and the footer says so instead of promising a reply.
  await page.locator('.opt[data-opt="B"]').click();
  await page.locator("#send").click();
  await page.waitForFunction(() => document.getElementById("staged-list").textContent.includes("Sent #1"));
  assert.match(await page.locator("#staged-list").textContent(), /Sent #1 · queued until an agent listens/);
  if (evidence) await page.screenshot({ path: join(evidence, "listener-queued.png") });

  // Resume from the agent's last handled send: the saved browser action is replayed by wait.
  const saved = JSON.parse(readFileSync(join(session, "events.jsonl"), "utf8").trim());
  const replay = JSON.parse(cli(["wait", "--session", session, "--after", "0", "--timeout", "5"]));
  assert.deepEqual(replay, saved, "resuming wait receives the exact queued browser send");
  assert.equal(replay.seq, 1);
  assert.equal(replay.actions[0].option, "B");
  if (evidence) writeFileSync(join(evidence, "listener-replay.json"), JSON.stringify({ ready, saved, replay }, null, 2) + "\n");

  // An agent starts listening: a running wait clears the indicator.
  goQuiet();
  await unheard();
  waiter = spawn(process.execPath, [server, "wait", "--session", session, "--after", "1", "--timeout", "30"], { env, stdio: ["ignore", "pipe", "inherit"] });
  await heard();
  assert.match(await status(), /Agent waiting for you/);
  assert.match(await page.locator("#staged-list").textContent(), /Sent #1 · waiting for the agent/);
  if (evidence) await page.screenshot({ path: join(evidence, "listener-back.png") });
  const heartbeat = () => JSON.parse(readFileSync(join(session, "listener.json"), "utf8"));
  const firstBeat = heartbeat();
  assert.equal(firstBeat.pid, waiter.pid);
  await page.waitForTimeout(2500);
  assert.ok(Date.parse(heartbeat().at) > Date.parse(firstBeat.at), "a blocked wait keeps renewing its heartbeat");

  // While the agent works on a send it is not in `wait`, and that is expected: no indicator.
  await new Promise((resolve) => { waiter.once("exit", resolve); waiter.kill(); });
  patch({ agent: { status: "working" } });
  goQuiet();
  await page.waitForFunction(() => document.getElementById("agent-status").textContent.includes("Agent working"));
  await page.waitForTimeout(2500);
  assert.doesNotMatch(await status(), /No agent is listening/, "a working agent is not flagged");

  // Back to waiting, then the listener goes away: the indicator returns.
  patch({ agent: { status: "waiting", handled: 1 } });
  goQuiet();
  await unheard();

  // An unavailable listener endpoint is unknown, not evidence that the agent is absent.
  await page.route("**/listener", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await heard();
  await page.unroute("**/listener");
  await unheard();

  // A completed session has no need for a listener, even when its heartbeat is stale.
  patch({ finished: { doc: "docs/listener-design.md" } });
  goQuiet();
  await page.waitForFunction(() => document.getElementById("staged-list").textContent.includes("This grill is finished."));
  assert.doesNotMatch(await status(), /No agent is listening/);
  assert.deepEqual(errors, []);
  console.log("listener e2e: passed (none → shown, queued send replayed, wait clears it, working not flagged, stale shows again, unknown and finished not flagged)");
} finally {
  try {
    if (waiter && waiter.exitCode === null) waiter.kill();
    await browser?.close();
  } finally {
    try { process.kill(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).pid); } catch { /* already stopped */ }
  }
}
