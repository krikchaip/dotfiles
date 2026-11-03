// Regression: answering a new round acknowledges the send without redrawing an existing visual.
// PLAYWRIGHT_PKG=/path/to/@playwright/test/index.mjs node test/manual-visual.e2e.mjs
// Optional GRILL_EVIDENCE_DIR saves sandbox screenshots and the actual persisted sends.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_PKG || "@playwright/test");
const evidence = process.env.GRILL_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const server = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const env = { ...process.env, GRILL_HOME: mkdtempSync(join(tmpdir(), "grill-manual-visual-")) };
const { session } = JSON.parse(execFileSync(process.execPath, [server, "new", "--topic", "Manual visuals"], { env, encoding: "utf8" }));
const stateFile = join(session, "state.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const question = (id, round) => ({ id, round, deps: [], title: `Question ${round}`, body: "Choose a direction.", options: [{ k: "A", text: "First" }, { k: "B", text: "Second" }], rec: { option: "A", why: "A fits." }, status: "open", thread: [] });
state.questions = [question("q1", 1)];
state.agent = { status: "waiting", since: new Date().toISOString(), handled: 0 };
state.visual = { kind: "prototype", version: 1, at: new Date().toISOString(), note: "Initial visual", thread: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
save();
writeFileSync(join(session, "visual.html"), "<!doctype html><title>Visual fixture</title><p id='content'>Version one</p>");
const child = spawn(process.execPath, [server, "serve", "--session", session], { env, stdio: ["ignore", "pipe", "inherit"] });
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Server did not become ready")), 5000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n").find((s) => s.includes('"type":"ready"'));
      if (line) { clearTimeout(timeout); resolve(JSON.parse(line).url); }
    });
  });
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator(".opt.rec").waitFor();
  await page.frameLocator("#visual-frame").locator("#content").waitFor({ state: "attached" });
  await page.frameLocator("#visual-frame").locator("#content").evaluate((el) => { el.dataset.retained = "yes"; });
  await page.locator(".opt.rec").click();
  await page.locator("#send").click();
  await page.locator(".mark.pending .spin").waitFor();

  // The agent publishes the answer, next question, acknowledgement, and stale flag together.
  // There is intentionally no new HTML file or visual version.
  state.questions[0].status = "answered";
  state.questions[0].answer = { kind: "accept", option: "A" };
  state.questions.push(question("q2", 2));
  state.agent.handled = 1;
  state.agent.since = new Date().toISOString();
  state.visual.stale = true;
  save();
  await page.waitForFunction(() => document.querySelector(".item.selected .id")?.textContent === "Q2");
  assert.equal(await page.locator(".mark.pending, .pending-line, #staged-list .sent").count(), 0, "the completed send clears without a visual redraw");
  assert.equal(await page.locator(".item .mark.answered svg").count(), 1);
  await page.locator(".opt.rec").click();
  assert.equal(await page.locator("#send").isEnabled(), true, "the new round can be answered immediately");
  assert.equal(await page.frameLocator("#visual-frame").locator("#content").getAttribute("data-retained"), "yes", "a new round must not reload the visual");
  await page.locator("#visualize").click();
  assert.equal(await page.locator("#visual-stale").count(), 1, "an older visual is visibly marked out of date");
  assert.match(await page.locator("#visual-stale").textContent(), /out of date/i);
  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").length, 1, "ordinary updates and viewing the visual do not request regeneration");

  // Staleness and the acknowledged send remain correct across reloads.
  await page.reload();
  await page.locator("#visual-stale").waitFor();
  assert.equal(await page.locator(".mark.pending, #staged-list .sent").count(), 0);
  await page.locator("#regen").click();
  await page.waitForFunction(() => document.querySelector("#visual-strip")?.textContent.includes("regenerating"));
  const events = readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events[1].actions, [{ type: "visualize", subagent: true }], "only the explicit Regenerate click requests a draw");
  assert.equal(events.length, 2);

  writeFileSync(join(session, "visual.html"), "<!doctype html><title>Visual fixture</title><p id='content'>Version two</p>");
  state.visual.version = 2;
  state.visual.stale = false;
  state.agent.handled = 2;
  save();
  await page.waitForFunction(() => document.querySelector("#visual-frame")?.getAttribute("src") === "/visual?v=2");
  assert.equal(await page.locator("#visual-stale").count(), 0, "a successful requested draw clears the stale indication");
  assert.equal(await page.frameLocator("#visual-frame").locator("#content").textContent(), "Version two");

  // The visual's scripts run, but never with the grill's origin: not in the iframe, and not
  // when the visual is opened directly in a tab (the server sends a sandbox CSP with it).
  writeFileSync(join(session, "visual.html"), `<!doctype html><title>Visual sandbox check</title><h1 id='content'>Visual sandbox check</h1><p>Script execution: <span id='ran'></span></p><p>Session read (/state): <span id='read'></span></p><p>Send to agent (/send): <span id='sent'></span></p>
<script>
const put = (id, v) => { document.getElementById(id).textContent = v; };
put("ran", "scripts run");
fetch("/state").then((r) => r.text()).then((t) => (t.includes("Manual visuals") ? "read" : "empty"), () => "blocked").then((v) => put("read", v));
fetch("/send", { method: "POST", body: JSON.stringify({ actions: [{ type: "visualize" }] }) }).then((r) => "status " + r.status, () => "blocked").then((v) => put("sent", v));
</script>`);
  state.visual.version = 3;
  save();
  await page.waitForFunction(() => document.querySelector("#visual-frame")?.getAttribute("src") === "/visual?v=3");
  const frame = page.frameLocator("#visual-frame");
  await frame.locator("#sent").filter({ hasText: /./ }).waitFor();
  await frame.locator("#read").filter({ hasText: /./ }).waitFor();
  assert.equal(await frame.locator("#ran").textContent(), "scripts run", "the visual's scripts still run in the iframe");
  assert.equal(await frame.locator("#read").textContent(), "blocked", "the iframed visual cannot read /state");
  assert.notEqual(await frame.locator("#sent").textContent(), "status 200", "the iframed visual cannot send to the agent");
  if (evidence) await page.screenshot({ path: join(evidence, "sandbox-iframe.png"), fullPage: true });
  const tab = await browser.newPage();
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(url + "visual?v=3");
  await tab.locator("#sent").filter({ hasText: /./ }).waitFor();
  await tab.locator("#read").filter({ hasText: /./ }).waitFor();
  assert.equal(await tab.locator("#ran").textContent(), "scripts run", "the visual's scripts run when opened directly");
  assert.equal(await tab.locator("#read").textContent(), "blocked", "the visual opened directly cannot read /state");
  assert.notEqual(await tab.locator("#sent").textContent(), "status 200", "the visual opened directly cannot send to the agent");
  if (evidence) {
    await tab.screenshot({ path: join(evidence, "sandbox-direct-tab.png"), fullPage: true });
    writeFileSync(join(evidence, "sandbox-events.jsonl"), readFileSync(join(session, "events.jsonl")));
    const results = async (surface) => ({
      scripts: await surface.locator("#ran").textContent(),
      stateRead: await surface.locator("#read").textContent(),
      send: await surface.locator("#sent").textContent(),
    });
    writeFileSync(join(evidence, "sandbox-results.json"), JSON.stringify({
      iframe: await results(frame), directTab: await results(tab),
      eventsBeforeVisual: events.length,
      eventsAfterVisual: readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").length,
    }, null, 2));
  }
  await tab.close();
  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").length, 2, "neither copy of the visual landed a send");

  assert.deepEqual(errors, []);
  console.log("manual visual e2e: passed (acknowledgement, next-round input, preserved iframe, stale status, explicit regeneration, reload, sandboxed visual)");
} finally {
  await browser?.close();
  if (child.exitCode === null) await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
}
