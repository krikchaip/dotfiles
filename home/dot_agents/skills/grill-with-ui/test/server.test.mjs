// Tests for server.mjs: session creation, serve (page/state/send), wait, url, sessions, pending, patch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "server.mjs");
const home = mkdtempSync(join(tmpdir(), "grill-home-"));
const env = { ...process.env, GRILL_HOME: home };
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const run = (args, opts = {}) => execFileSync(process.execPath, [SERVER, ...args], { encoding: "utf8", env, ...opts }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body) => fetch(url + "send", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

function lineReader(stream) {
  const lines = []; const waiters = []; let buf = "";
  stream.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.splice(0).forEach((w) => w()); } });
  const nth = (n) => new Promise((res) => { const check = () => (lines.length >= n ? res(lines[n - 1]) : waiters.push(check)); check(); });
  return { lines, nth };
}
async function startServe(session, extra = []) {
  const child = spawn(process.execPath, [SERVER, "serve", "--session", session, ...extra], { env, stdio: ["ignore", "pipe", "inherit"] });
  const out = lineReader(child.stdout);
  const ready = JSON.parse(await out.nth(1));
  const stop = () => new Promise((res) => { if (child.exitCode !== null) return res(); child.on("exit", res); child.kill(); });
  return { child, ready, out, stop };
}
const newSession = (cwd, topic = "Fonts") => JSON.parse(run(["new", "--topic", topic], { cwd }));

test("new: outside git the key comes from the cwd; state.json skeleton is written", () => {
  const cwd = tmp("grill-nogit-");
  const out = newSession(cwd);
  const real = realpathSync(cwd);
  assert.equal(out.project, real);
  assert.equal(out.key, real.replace(/^\//, "").replace(/\//g, "-"));
  assert.ok(out.session.startsWith(join(home, "sessions", out.key) + "/"), out.session);
  const state = JSON.parse(readFileSync(join(out.session, "state.json"), "utf8"));
  assert.equal(state.topic, "Fonts");
  assert.deepEqual(state.questions, []);
  assert.equal(state.agent.status, "working");
  assert.match(state.created, /^\d{4}-\d{2}-\d{2}T/);
});

test("new: a git repo and one of its worktrees share one key; two sessions never collide", () => {
  const repo = tmp("grill-repo-");
  const git = (args, cwd) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
  git(["init", "-q", "-b", "main"], repo);
  git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
  const wt = join(tmp("grill-wt-"), "wt");
  git(["worktree", "add", "-q", wt, "-b", "side"], repo);
  const a = newSession(repo), b = newSession(wt), c = newSession(repo);
  assert.equal(a.key, b.key);
  assert.equal(a.project, realpathSync(repo));
  assert.equal(b.project, realpathSync(repo));
  assert.notEqual(a.session, c.session);
});

test("serve: ready line + server.json, page, state, send appends the same line it prints, bad bodies are 400, seq survives restart", async (t) => {
  const { session } = newSession(tmp("grill-s-"));
  const s = await startServe(session); t.after(s.stop);
  assert.equal(s.ready.type, "ready");
  assert.match(s.ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(s.ready.session, session);
  assert.equal(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).url, s.ready.url);

  const html = await (await fetch(s.ready.url)).text();
  assert.match(html, /<textarea/);
  const state = await (await fetch(s.ready.url + "state")).json();
  assert.equal(state.topic, "Fonts");

  const actions = [{ q: "q1", type: "answer", kind: "text", text: "B, bundle them" }];
  const r1 = await post(s.ready.url, { actions });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, seq: 1 });
  const ev = JSON.parse(await s.out.nth(2));
  assert.equal(ev.type, "send"); assert.equal(ev.seq, 1); assert.equal(ev.session, session);
  assert.deepEqual(ev.actions, actions);
  assert.match(ev.at, /^\d{4}-\d{2}-\d{2}T/);
  const fileLines = readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n");
  assert.equal(fileLines.length, 1);
  assert.equal(fileLines[0], s.out.lines[1]);

  assert.equal((await post(s.ready.url, "nope")).status, 400);
  assert.equal((await post(s.ready.url, { actions: [] })).status, 400);
  assert.equal((await post(s.ready.url, { actions: "x" })).status, 400);
  await sleep(100);
  assert.equal(s.out.lines.length, 2, "bad bodies print nothing");
  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").length, 1);

  await s.stop();
  const s2 = await startServe(session); t.after(s2.stop);
  const r2 = await post(s2.ready.url, { actions: [{ q: "q1", type: "thread", text: "why not C?" }] });
  assert.deepEqual(await r2.json(), { ok: true, seq: 2 });
  assert.equal(JSON.parse(await s2.out.nth(2)).seq, 2);
});

test("serve: /send rejects a mismatched Origin, allows same-origin and no-Origin requests", async (t) => {
  const { session } = newSession(tmp("grill-o-"));
  const s = await startServe(session); t.after(s.stop);
  const actions = [{ q: "q1", type: "defer" }];
  const withOrigin = (origin, contentType = "application/json") =>
    fetch(s.ready.url + "send", { method: "POST", headers: { "content-type": contentType, origin }, body: JSON.stringify({ actions }) });

  assert.equal((await post(s.ready.url, { actions })).status, 200, "no Origin header (curl, wait mode, tests) is allowed");
  assert.equal((await withOrigin(s.ready.url.slice(0, -1))).status, 200, "the page's own origin is allowed");
  const port = Number(new URL(s.ready.url).port);
  assert.equal((await withOrigin(`http://localhost:${port}`)).status, 200, "the same server opened as localhost is allowed");
  assert.equal((await withOrigin(`http://localhost:${port + 1}`)).status, 403, "localhost on another port is still rejected");
  assert.equal((await withOrigin("https://evil.example", "text/plain")).status, 403, "a foreign origin is rejected even as a no-preflight content-type");
  assert.equal((await withOrigin("null")).status, 403, "the sandboxed visual iframe's opaque origin is rejected too");

  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8").trim().split("\n").length, 3, "only the three accepted sends landed");
});

test("theme: POST /theme persists globally, is injected into every grill's page, and is origin-guarded", async (t) => {
  const a = await startServe(newSession(tmp("grill-t1-")).session); t.after(a.stop);
  const b = await startServe(newSession(tmp("grill-t2-")).session); t.after(b.stop);
  assert.notEqual(new URL(a.ready.url).port, new URL(b.ready.url).port, "two grills on two ports");

  const themeOf = async (url) => (await (await fetch(url)).text()).match(/<html[^>]*data-theme="([^"]+)"/)[1];
  assert.equal(await themeOf(a.ready.url), "system", "defaults to system");
  const setTheme = (url, theme, origin) =>
    fetch(url + "theme", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ theme }) });

  assert.equal((await setTheme(a.ready.url, "dark")).status, 200);
  assert.equal(await themeOf(a.ready.url), "dark", "the grill that set it sees it");
  assert.equal(await themeOf(b.ready.url), "dark", "a grill on another port sees it too, no localStorage");

  assert.equal((await setTheme(a.ready.url, "chartreuse")).status, 400, "an unknown theme is rejected");
  assert.equal((await setTheme(a.ready.url, "light", "https://evil.example")).status, 403, "a foreign origin is rejected");
  assert.equal(await themeOf(b.ready.url), "dark", "rejected writes changed nothing");
});

test("wait: blocks for a seq newer than --after (default: current last), prints it, exits 0; exit 3 on timeout", async (t) => {
  const { session } = newSession(tmp("grill-w-"));
  const s = await startServe(session); t.after(s.stop);
  await post(s.ready.url, { actions: [{ q: "q1", type: "defer" }] });
  await s.out.nth(2);

  const w = spawn(process.execPath, [SERVER, "wait", "--session", session, "--after", "1", "--timeout", "5"], { env, stdio: ["ignore", "pipe", "inherit"] });
  const wo = lineReader(w.stdout);
  await sleep(400);
  assert.equal(wo.lines.length, 0, "nothing printed before a new send");
  await post(s.ready.url, { actions: [{ q: "q1", type: "answer", kind: "option", option: "A" }] });
  const code = await new Promise((res) => w.on("exit", res));
  assert.equal(code, 0);
  assert.equal(wo.lines.length, 1);
  assert.equal(JSON.parse(wo.lines[0]).seq, 2);

  // The default --after latches the last seq on disk as the process starts, so a send that
  // lands while node is still booting counts as already-seen and this wait blocks on it.
  // Sleeping before the post bets on cold-start time and loses that bet on a loaded machine.
  // Post until the wait answers instead, and assert on what it printed rather than on how
  // many tries it took.
  const w2 = spawn(process.execPath, [SERVER, "wait", "--session", session, "--timeout", "20"], { env, stdio: ["ignore", "pipe", "inherit"] });
  const wo2 = lineReader(w2.stdout);
  const exited2 = new Promise((res) => w2.on("exit", res));
  for (let i = 0; i < 80 && !wo2.lines.length; i++) {
    await post(s.ready.url, { actions: [{ q: "q1", type: "reopen" }] });
    await sleep(250);
  }
  assert.equal(await exited2, 0);
  const seen2 = JSON.parse(wo2.lines[0]);
  assert.ok(seen2.seq > 2, `default --after skips everything already on disk (printed seq ${seen2.seq})`);
  assert.equal(seen2.actions[0].type, "reopen", "and prints a send that arrived after it started");

  const w3 = spawn(process.execPath, [SERVER, "wait", "--session", session, "--timeout", "0.5"], { env, stdio: ["ignore", "pipe", "inherit"] });
  const wo3 = lineReader(w3.stdout);
  assert.equal(await new Promise((res) => w3.on("exit", res)), 3);
  assert.equal(wo3.lines.length, 0);
});

test("serve: /visual serves the session's visual.html (no-store), 404 JSON when absent", async (t) => {
  const { session } = newSession(tmp("grill-v-"));
  const s = await startServe(session); t.after(s.stop);
  const miss = await fetch(s.ready.url + "visual");
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { error: "no visual" });
  const html = "<!doctype html><title>v</title><h1>Prototype</h1>";
  writeFileSync(join(session, "visual.html"), html);
  const hit = await fetch(s.ready.url + "visual?v=1");
  assert.equal(hit.status, 200);
  assert.match(hit.headers.get("content-type"), /^text\/html/);
  assert.equal(hit.headers.get("cache-control"), "no-store");
  assert.equal(await hit.text(), html);
});

// A raw request: fetch cannot set Host (it is a forbidden header), which is exactly what a
// DNS-rebinding page controls, so these go through node:http.
function raw(url, { method = "GET", path = "/", host, headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: u.hostname, port: u.port, method, path, setHost: host === undefined, headers: { ...(host === undefined ? {} : { host }), ...headers } }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("serve: every route answers only requests addressed to this server's own loopback name (DNS rebinding)", async (t) => {
  const { session } = newSession(tmp("grill-h-"));
  writeFileSync(join(session, "visual.html"), "<!doctype html><p>private plan</p>");
  const s = await startServe(session); t.after(s.stop);
  const port = Number(new URL(s.ready.url).port);
  const themeNow = async () => (await raw(s.ready.url, { host: `127.0.0.1:${port}` })).body.match(/data-theme="([^"]+)"/)[1];
  const themeBefore = await themeNow();
  const send = JSON.stringify({ actions: [{ q: "q1", type: "defer" }] });
  const routes = [
    { method: "GET", path: "/" }, { method: "GET", path: "/state" }, { method: "GET", path: "/events" },
    { method: "GET", path: "/visual?v=1" }, { method: "GET", path: "/nope" },
    { method: "POST", path: "/send", body: send, headers: { "content-type": "application/json" } },
    { method: "POST", path: "/theme", body: JSON.stringify({ theme: themeBefore === "light" ? "dark" : "light" }), headers: { "content-type": "application/json" } },
  ];
  for (const host of [`attacker.example:${port}`, "attacker.example", `127.0.0.1:${port + 1}`, `localhost:${port + 1}`, `127.0.0.1.attacker.example:${port}`, "127.0.0.1", ""]) {
    for (const r of routes) {
      const res = await raw(s.ready.url, { ...r, host });
      assert.equal(res.status, 403, `${r.method} ${r.path} with Host ${JSON.stringify(host)} must be refused`);
      assert.deepEqual(JSON.parse(res.body), { error: "unrecognized Host header" });
      assert.doesNotMatch(res.body, /private plan|Fonts/);
    }
  }
  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8"), "", "no refused send landed");
  assert.equal(s.out.lines.length, 1, "and none printed");
  assert.equal(await themeNow(), themeBefore, "a refused /theme changed nothing");

  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
    assert.equal((await raw(s.ready.url, { path: "/state", host })).status, 200, `Host ${host} is this server`);
  }
  assert.equal((await raw(s.ready.url, { method: "POST", path: "/send", host: `localhost:${port}`, body: send, headers: { "content-type": "application/json" } })).status, 200);

  // HTTP/1.0 lets a client leave Host out entirely; that is refused too.
  const noHost = await new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => sock.end("GET /state HTTP/1.0\r\n\r\n"));
    let b = ""; sock.setEncoding("utf8"); sock.on("data", (c) => { b += c; }); sock.on("end", () => resolve(b)); sock.on("error", reject);
  });
  assert.match(noHost, /^HTTP\/1\.[01] 403 /, "a request with no Host header is refused");
});

test("serve: /visual carries a sandbox CSP so it never runs with the grill's origin, even opened directly", async (t) => {
  const { session } = newSession(tmp("grill-csp-"));
  writeFileSync(join(session, "visual.html"), "<!doctype html><p>v</p>");
  const s = await startServe(session); t.after(s.stop);
  const hit = await fetch(s.ready.url + "visual?v=1");
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("content-security-policy"), "sandbox allow-scripts");
  const page = await fetch(s.ready.url);
  assert.equal(page.headers.get("content-security-policy"), null, "the page itself is not sandboxed");
});

test("serve: a request body over 1 MB is refused with 413 and nothing lands; a large real send still works", async (t) => {
  const { session } = newSession(tmp("grill-big-"));
  const s = await startServe(session); t.after(s.stop);
  const big = JSON.stringify({ actions: [{ q: "q1", type: "thread", text: "x".repeat(1024 * 1024) }] });

  const declared = await raw(s.ready.url, { method: "POST", path: "/send", body: big, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(big) } });
  assert.equal(declared.status, 413, "an oversize Content-Length is refused before the body is read");
  assert.deepEqual(JSON.parse(declared.body), { error: "request body too large (limit 1 MB)" });

  // Chunked: no Content-Length, so the cap has to hold while the body streams in.
  const chunked = await new Promise((resolve, reject) => {
    const u = new URL(s.ready.url);
    const req = request({ hostname: u.hostname, port: u.port, method: "POST", path: "/send", headers: { "content-type": "application/json", "transfer-encoding": "chunked" } }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; }); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", () => {}); // the server may close the socket while the rest is still being written
    req.on("close", () => setTimeout(() => reject(new Error("no response to a chunked oversize body")), 2000).unref());
    const chunk = "x".repeat(64 * 1024);
    let sent = 0;
    const pump = () => { while (sent < 4 * 1024 * 1024) { sent += chunk.length; if (!req.write(chunk)) return req.once("drain", pump); } req.end(); };
    req.write('{"actions":[{"q":"q1","type":"thread","text":"'); pump();
  });
  assert.equal(chunked.status, 413, "a streamed body is cut off at the cap");

  const themeBig = await raw(s.ready.url, { method: "POST", path: "/theme", body: JSON.stringify({ theme: "dark", pad: "x".repeat(1024 * 1024) }), headers: { "content-type": "application/json" } });
  assert.equal(themeBig.status, 413, "/theme has the same cap");

  assert.equal(readFileSync(join(session, "events.jsonl"), "utf8"), "", "no oversize send landed");
  const ok = await post(s.ready.url, { actions: [{ q: "q1", type: "thread", text: "é".repeat(200 * 1024) }] });
  assert.equal(ok.status, 200, "a long (400 KB) multibyte thread message is well under the cap");
  await s.out.nth(2);
  const landed = JSON.parse(readFileSync(join(session, "events.jsonl"), "utf8"));
  assert.equal(landed.actions[0].text, "é".repeat(200 * 1024), "multibyte text split across chunks survives intact");
});

test("url: prints the running server's url; fails fast when there is none", async (t) => {
  const { session } = newSession(tmp("grill-u-"));
  assert.throws(() => run(["url", "--session", session, "--timeout", "0.3"]));
  const s = await startServe(session); t.after(s.stop);
  assert.equal(run(["url", "--session", session]), s.ready.url);
});

// ---- serve --detach: the server daemonises itself, on every OS ----
// spawnSync waits for every pipe it handed out to close, not just for the parent to exit, so a
// detached server that kept the caller's stdout open would hang it: the wait-mode deadlock of
// issue #33. The timeout turns that hang into a failure instead of a stuck test run.
const detach = (session, extra = []) =>
  spawnSync(process.execPath, [SERVER, "serve", "--session", session, "--detach", ...extra], { env, encoding: "utf8", timeout: 15000 });
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const killPid = async (pid) => {
  if (!pid || !pidAlive(pid)) return;
  try { process.kill(pid); } catch { return; }
  for (let i = 0; i < 100 && pidAlive(pid); i++) await sleep(50);
};
// Kills whatever server.json names at the end of the test, so a failed assertion never leaves
// a detached server running.
const killSessionServer = (session) => async () => {
  try { await killPid(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).pid); } catch { /* none started */ }
};

test("serve --detach: starts a background server, prints its ready line and exits 0 without holding the caller's pipes", async (t) => {
  const { session } = newSession(tmp("grill-d-"));
  t.after(killSessionServer(session));
  const r = detach(session);
  assert.equal(r.error, undefined, `serve --detach must return (spawnSync error: ${r.error && r.error.code})`);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "one JSON line");
  const ready = JSON.parse(lines[0]);
  assert.equal(ready.type, "ready");
  assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(ready.session, session);
  assert.equal(ready.log, join(session, "serve.log"));
  assert.ok(Number.isInteger(ready.pid) && ready.pid !== r.pid, "the server is a separate process");
  assert.ok(pidAlive(ready.pid), "and it outlives the command that started it");
  assert.equal(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).pid, ready.pid);
  assert.equal(run(["url", "--session", session]), ready.url);
  assert.equal((await fetch(ready.url + "state")).status, 200);

  const sent = await (await post(ready.url, { actions: [{ q: "q1", type: "defer" }] })).json();
  assert.deepEqual(sent, { ok: true, seq: 1 });
  await sleep(100);
  assert.match(readFileSync(join(session, "serve.log"), "utf8"), /"type":"send","seq":1/, "the server's output goes to serve.log");

  const again = detach(session);
  assert.equal(again.status, 0, again.stderr);
  const second = JSON.parse(again.stdout.trim());
  assert.deepEqual(second, { ...ready, already: true }, "a second --detach reports the running server instead of starting another");
  assert.equal(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).pid, ready.pid);

  await killPid(ready.pid);
  const third = detach(session);
  assert.equal(third.status, 0, third.stderr);
  const restarted = JSON.parse(third.stdout.trim());
  assert.equal(restarted.url, ready.url, "a restart reuses the last port, so an open tab resumes");
  assert.notEqual(restarted.pid, ready.pid);
  assert.equal(restarted.already, undefined);
});

test("serve --detach: a server that cannot start exits non-zero with one line naming serve.log, and leaves nothing running", async (t) => {
  const { session } = newSession(tmp("grill-df-"));
  t.after(killSessionServer(session));
  const blocker = createServer(); await new Promise((r) => blocker.listen(0, "127.0.0.1", r)); t.after(() => blocker.close());
  const r = detach(session, ["--port", String(blocker.address().port)]);
  assert.equal(r.error, undefined);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^grill: [^\n]*serve\.log[^\n]*\n$/, r.stderr);
  assert.match(readFileSync(join(session, "serve.log"), "utf8"), /EADDRINUSE/);
});

test("serve --detach --open-command: the detached server opens the page once, after it listens; a reused server opens nothing", async (t) => {
  if (process.platform === "win32") { t.skip("shebang probes do not execute on Windows"); return; }
  const dir = tmp("grill-do-");
  const seen = join(dir, "opened.txt");
  const probe = join(dir, "probe.mjs");
  writeFileSync(probe, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(seen)}, process.argv[2] + "\\n");\n`);
  chmodSync(probe, 0o755);
  const { session } = newSession(dir);
  t.after(killSessionServer(session));
  const r = detach(session, ["--open-command", probe]);
  assert.equal(r.status, 0, r.stderr);
  const ready = JSON.parse(r.stdout.trim());
  const opened = () => { try { return readFileSync(seen, "utf8").trim().split("\n"); } catch { return []; } };
  for (let i = 0; i < 40 && !opened().length; i++) await sleep(100);
  assert.equal(JSON.parse(detach(session, ["--open-command", probe]).stdout.trim()).already, true);
  await sleep(500);
  assert.deepEqual(opened(), [ready.url], "opened exactly once, with the live URL");
  assert.match(readFileSync(join(session, "serve.log"), "utf8"), /grill: opened /, "the opener's note goes to serve.log, not the caller");
});

test("serve --detach composes with --lan and --host: the ready line carries the LAN URL, and a running server is found again", async (t) => {
  const ip = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal);
  if (!ip) { t.skip("no LAN IPv4 interface on this machine"); return; }
  const { session } = newSession(tmp("grill-dl-"));
  t.after(killSessionServer(session));
  const r = detach(session, ["--lan"]);
  assert.equal(r.status, 0, r.stderr);
  const ready = JSON.parse(r.stdout.trim());
  t.after(() => killPid(ready.pid));
  assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.match(ready.lanUrl || "", /^http:\/\/[\d.]+:\d+\/\?t=[0-9a-f]{32}$/, "the detached ready line carries the LAN URL");
  assert.equal(ready.lanUrl, JSON.parse(readFileSync(join(session, "server.json"), "utf8")).lanUrl);
  const lan = new URL(ready.lanUrl);
  assert.equal((await fetch(`${lan.origin}/state${lan.search}`)).status, 200, "the LAN URL is served");
  assert.equal((await fetch(`${lan.origin}/listener`)).status, 403, "LAN /listener without the token is refused");
  assert.deepEqual(JSON.parse(detach(session, ["--lan"]).stdout.trim()), { ...ready, already: true });
  await killPid(ready.pid);

  // --host ADDR: the printed URL is the tokenized LAN address, and the liveness check must keep the token.
  const { session: s2 } = newSession(tmp("grill-dh-"));
  t.after(killSessionServer(s2));
  const h = detach(s2, ["--host", ip.address]);
  assert.equal(h.status, 0, h.stderr);
  const hr = JSON.parse(h.stdout.trim());
  t.after(() => killPid(hr.pid)); // a second server, if one was wrongly started, is the one server.json names
  assert.match(hr.url, new RegExp(`^http://${ip.address.replace(/\./g, "\\.")}:\\d+/\\?t=[0-9a-f]{32}$`));
  const again = JSON.parse(detach(s2, ["--host", ip.address]).stdout.trim());
  assert.deepEqual(again, { ...hr, already: true }, "a second --detach finds the running --host server instead of starting another");
});

// ---- listener: can the page tell whether an agent is listening? ----
const listener = async (url) => (await fetch(url + "listener")).json();
const ago = (ms) => new Date(Date.now() - ms);
// A fresh `new` or patch counts as a sign of life; push state.json's mtime into the past so
// only the listener under test speaks.
const quiet = (session) => utimesSync(join(session, "state.json"), ago(10 * 60_000), ago(10 * 60_000));

test("listener: a serve nobody reads is not a listener; a running wait is; its heartbeat goes stale; a patch counts", async (t) => {
  const { session } = newSession(tmp("grill-l-"));
  t.after(killSessionServer(session));
  quiet(session);
  const ready = JSON.parse(detach(session).stdout.trim());
  let l = await listener(ready.url);
  assert.equal(l.listening, false, "a detached server's output goes to a file: nobody is listening");
  assert.equal(l.session, session);

  const w = spawn(process.execPath, [SERVER, "wait", "--session", session, "--timeout", "20"], { env, stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (w.exitCode === null) w.kill(); });
  for (let i = 0; i < 60 && !(l = await listener(ready.url)).listening; i++) await sleep(100);
  assert.equal(l.listening, true, "a running wait marks the session as listened to");
  assert.equal(l.via, "wait");
  assert.ok(Date.now() - Date.parse(l.at) < 5000, l.at);
  await new Promise((res) => { w.on("exit", res); w.kill(); });

  // The heartbeat outlives the wait for a short grace (the loop re-runs wait), then goes stale.
  writeFileSync(join(session, "listener.json"), JSON.stringify({ via: "wait", pid: w.pid, at: ago(5 * 60_000).toISOString() }));
  l = await listener(ready.url);
  assert.equal(l.listening, false, "a heartbeat minutes old is not a listener");
  assert.equal(l.via, "wait", "the last sign is still reported");

  run(["patch", "--session", session], { input: JSON.stringify({ agent: { status: "waiting" } }) });
  l = await listener(ready.url);
  assert.equal(l.listening, true, "the agent just patched state.json: it is active");
  assert.equal(l.via, "patch");
});

test("listener: a serve whose output is piped to a reader (a Monitor) is itself the listener", async (t) => {
  const { session } = newSession(tmp("grill-lm-"));
  quiet(session);
  const s = await startServe(session); t.after(s.stop);
  const l = await listener(s.ready.url);
  assert.equal(l.listening, true);
  assert.equal(l.via, "serve");
});

test("serve: reuses the last port from server.json, falls back to ephemeral when it is taken; --port wins", async (t) => {
  const { session } = newSession(tmp("grill-p-"));
  const s1 = await startServe(session); t.after(s1.stop);
  const port = Number(new URL(s1.ready.url).port);
  assert.equal(JSON.parse(readFileSync(join(session, "server.json"), "utf8")).port, port);
  await s1.stop();
  const s2 = await startServe(session); t.after(s2.stop);
  assert.equal(s2.ready.url, s1.ready.url, "same port after restart");
  await s2.stop();
  const blocker = createServer(); await new Promise((r) => blocker.listen(port, "127.0.0.1", r)); t.after(() => blocker.close());
  const s3 = await startServe(session); t.after(s3.stop);
  assert.notEqual(new URL(s3.ready.url).port, String(port), "falls back when the port is taken");
  assert.equal((await fetch(s3.ready.url + "state")).status, 200);
  await s3.stop(); await new Promise((r) => blocker.close(r));
  const s4 = await startServe(session, ["--port", "0"]); t.after(s4.stop);
  assert.notEqual(new URL(s4.ready.url).port, String(port), "explicit --port 0 skips reuse");
});

test("sessions: lists this project's sessions newest first, unfinished by default, --all includes finished", async () => {
  const cwd = tmp("grill-ls-");
  const a = newSession(cwd, "First topic");
  await sleep(20);
  const b = newSession(cwd, "Second topic");
  await sleep(20);
  const c = newSession(cwd, "Finished topic");
  const stateOf = (dir) => JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  const write = (dir, st) => writeFileSync(join(dir, "state.json"), JSON.stringify(st));
  const sb = stateOf(b.session);
  sb.agent = { status: "waiting", since: "x", handled: 2 };
  sb.questions = [
    { id: "q1", round: 1, status: "answered" }, { id: "q2", round: 1, status: "open" },
    { id: "q3", round: 2, status: "deferred" }, { id: "q4", round: 2, status: "reopened" },
  ];
  write(b.session, sb);
  writeFileSync(join(b.session, "events.jsonl"), '{"seq":1}\n{"seq":2}\n{"seq":3}\n');
  const sc = stateOf(c.session); sc.finished = { doc: "docs/x.md", at: "y" }; write(c.session, sc);

  const lines = run(["sessions"], { cwd }).split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.session), [b.session, a.session]);
  assert.deepEqual(lines[0], { session: b.session, id: b.id, topic: "Second topic", intent: "", doc: "", created: sb.created, finished: null, open: 2, answered: 1, handled: 2, lastSeq: 3 });
  assert.deepEqual(lines[1], { session: a.session, id: a.id, topic: "First topic", intent: "", doc: "", created: stateOf(a.session).created, finished: null, open: 0, answered: 0, handled: 0, lastSeq: 0 });
  const all = run(["sessions", "--all"], { cwd }).split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(all.map((l) => l.session), [c.session, b.session, a.session]);
  assert.deepEqual(all[0].finished, { doc: "docs/x.md", at: "y" });
  assert.equal(run(["sessions"], { cwd: tmp("grill-empty-") }), "");
});

test("new --intent is stored and listed; patch replaces it whole; non-string intent is rejected", () => {
  const cwd = tmp("grill-intent-");
  const out = JSON.parse(run(["new", "--topic", "Auth", "--intent", "Decide how sessions remember a user across tabs", "--doc", "docs/auth-design.md"], { cwd }));
  assert.equal(out.intent, "Decide how sessions remember a user across tabs");
  const st = JSON.parse(readFileSync(join(out.session, "state.json"), "utf8"));
  assert.equal(st.intent, "Decide how sessions remember a user across tabs");
  const lines = run(["sessions"], { cwd }).split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].intent, "Decide how sessions remember a user across tabs");
  assert.equal(lines[0].doc, "docs/auth-design.md");

  const session = seeded({ questions: [qn("q1", 1)] });
  applied(session, { intent: "A clearer why for this grill" });
  assert.equal(stateOf(session).intent, "A clearer why for this grill");
  applied(session, { intent: null });
  assert.ok(!("intent" in stateOf(session)));
  rejected(session, { intent: 12 }, /intent/);
});

test("pending: prints the events past agent.handled, nothing when caught up", async (t) => {
  const { session } = newSession(tmp("grill-pd-"));
  const s = await startServe(session); t.after(s.stop);
  for (const k of ["A", "B", "C"]) await post(s.ready.url, { actions: [{ q: "q1", type: "answer", kind: "option", option: k }] });
  await s.out.nth(4);
  const st = JSON.parse(readFileSync(join(session, "state.json"), "utf8"));
  st.agent.handled = 1; writeFileSync(join(session, "state.json"), JSON.stringify(st));
  const out = run(["pending", "--session", session]).split("\n");
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((l) => JSON.parse(l).seq), [2, 3]);
  assert.equal(out[0], s.out.lines[2], "prints the exact stored lines");
  st.agent.handled = 3; writeFileSync(join(session, "state.json"), JSON.stringify(st));
  assert.equal(run(["pending", "--session", session]), "");
  delete st.agent.handled; writeFileSync(join(session, "state.json"), JSON.stringify(st));
  assert.equal(run(["pending", "--session", session]).split("\n").length, 3, "no handled means everything is pending");
});

// ---- patch: the agent's only way to write state.json ----
const T0 = "2026-09-01T10:00:00.000Z";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const stateOf = (session) => JSON.parse(readFileSync(join(session, "state.json"), "utf8"));
const rawState = (session) => readFileSync(join(session, "state.json"), "utf8");
const leftovers = (session) => readdirSync(session).filter((f) => !["state.json", "events.jsonl", "server.json"].includes(f));
const qn = (id, round, extra = {}) => ({
  id, round, deps: [], title: `Title ${id}`, body: `Body ${id}`,
  options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }], rec: { option: "A", why: "Alpha is simpler." },
  status: "open", durable: false, updated: false, thread: [], ...extra,
});
function seeded(fields = {}) {
  const { session } = newSession(tmp("grill-pt-"), "Patch topic");
  const st = { ...stateOf(session), agent: { status: "waiting", since: T0, handled: 0 }, ...fields };
  writeFileSync(join(session, "state.json"), JSON.stringify(st, null, 2));
  return session;
}
function patch(session, body, extra = []) {
  const input = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const r = spawnSync(process.execPath, [SERVER, "patch", "--session", session, ...extra], { env, input, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function applied(session, body, extra) {
  const r = patch(session, body, extra);
  assert.equal(r.code, 0, `patch failed: ${r.err}`);
  assert.equal(r.err, "");
  return r;
}
// A time the server stamped: ISO, and taken while the patch between t1 and t2 ran.
function stampedBetween(at, t1, t2, what) {
  assert.match(String(at), ISO, `${what} is an ISO time`);
  const t = Date.parse(at);
  assert.ok(t >= t1 - 1000 && t <= t2 + 1000, `${what} (${at}) was stamped by this patch`);
}
function rejected(session, body, pattern, extra) {
  const before = rawState(session);
  const r = patch(session, body, extra);
  assert.notEqual(r.code, 0, `expected a rejection for ${typeof body === "string" ? body : JSON.stringify(body)}`);
  assert.equal(r.out, "", "nothing on stdout when rejected");
  assert.match(r.err, /^grill: [^\n]+\n$/, "exactly one line on stderr");
  if (pattern) assert.match(r.err, pattern);
  assert.equal(rawState(session), before, "state.json untouched");
  assert.deepEqual(leftovers(session), [], "no temp file left behind");
  return r;
}

test("patch: agent and visual merge one level; other top-level keys are replaced whole; stdout is one short line", () => {
  const session = seeded({
    note: "old note", doc: "docs/a-design.md",
    agent: { status: "working", since: T0, handled: 3 },
    questions: [qn("q1", 1), qn("q2", 1, { status: "answered", answer: { kind: "accept" } })],
    visual: { kind: "prototype", version: 2, at: T0, note: "v2: first", stale: true, drawing: { since: T0, seq: 3 }, thread: [{ who: "user", text: "bigger", at: T0 }] },
  });
  const r = applied(session, {
    agent: { handled: 4 },
    visual: { stale: false, note: "v3: bigger", drawing: { since: "2026-09-01T11:00:00.000Z", seq: 4 } },
    note: "new note", doc: "docs/b-design.md", finished: { doc: "docs/b-design.md", visual: "docs/b-visual.html", at: T0 },
  });
  const st = stateOf(session);
  assert.deepEqual(st.agent, { status: "working", since: T0, handled: 4 });
  assert.deepEqual(st.visual, { kind: "prototype", version: 2, at: T0, note: "v3: bigger", stale: false, drawing: { since: "2026-09-01T11:00:00.000Z", seq: 4 }, thread: [{ who: "user", text: "bigger", at: T0 }] });
  assert.equal(st.note, "new note");
  assert.equal(st.doc, "docs/b-design.md");
  assert.equal(st.topic, "Patch topic", "untouched keys stay");
  assert.equal(st.questions.length, 2);

  assert.match(r.out, /^[^\n]+\n$/, "exactly one line on stdout");
  assert.ok(r.out.length < 120, `short: ${r.out}`);
  assert.deepEqual(JSON.parse(r.out), { ok: true, questions: 2, open: 1, handled: 4, bytes: statSync(join(session, "state.json")).size });
  for (const leak of ["Patch topic", "Title q1", "bigger", "new note"]) assert.ok(!r.out.includes(leak), `stdout never echoes the state (${leak})`);
  assert.deepEqual(leftovers(session), [], "no temp file left behind");

  applied(session, { finished: { doc: "docs/c-design.md", at: T0 } });
  assert.deepEqual(stateOf(session).finished, { doc: "docs/c-design.md", at: T0 }, "finished is replaced whole, not merged");
});

test("patch: questions merge one level by id; each given field replaces that field whole", () => {
  const explore = { at: T0, rows: [{ option: "A", pros: ["p"], cons: ["c"] }] };
  const session = seeded({
    questions: [
      qn("q1", 1, { updated: true, explore, thread: [{ who: "user", text: "hm", at: T0 }, { who: "agent", text: "ok", at: T0 }] }),
      qn("q2", 1),
    ],
  });
  const before = stateOf(session);
  applied(session, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", option: "B" }, rec: { option: "B" }, updated: false, options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }, { k: "C", text: "Gamma" }] }] });
  const st = stateOf(session);
  assert.deepEqual(st.questions.map((q) => q.id), ["q1", "q2"], "order kept, nothing appended");
  const q1 = st.questions[0];
  assert.deepEqual(q1.rec, { option: "B" }, "rec replaced whole, not deep-merged");
  assert.deepEqual(q1.answer, { kind: "option", option: "B" });
  assert.equal(q1.status, "answered");
  assert.equal(q1.updated, false);
  assert.equal(q1.options.length, 3);
  assert.equal(q1.title, "Title q1");
  assert.equal(q1.body, "Body q1");
  assert.deepEqual(q1.explore, explore);
  assert.deepEqual(q1.thread, before.questions[0].thread, "thread untouched when the patch has none");
  assert.deepEqual(st.questions[1], before.questions[1], "other questions untouched");
});

test("patch: a new id with a title is appended with defaults; an unknown id without a title is rejected, state untouched", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  applied(session, { questions: [
    { id: "q2", round: 2, deps: ["q1"], title: "Second", body: "B2", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "w" }, durable: true },
    { id: "q3", round: 2, title: "Free text", body: "B3", rec: { text: "Something", why: "w" } },
  ] });
  const st = stateOf(session);
  assert.deepEqual(st.questions.map((q) => q.id), ["q1", "q2", "q3"]);
  assert.deepEqual(st.questions[1], { id: "q2", round: 2, deps: ["q1"], title: "Second", body: "B2", options: [{ k: "A", text: "Yes" }], rec: { option: "A", why: "w" }, durable: true, status: "open", thread: [], updated: false });
  assert.deepEqual(st.questions[2], { id: "q3", round: 2, title: "Free text", body: "B3", rec: { text: "Something", why: "w" }, status: "open", deps: [], options: [], thread: [], durable: false, updated: false });

  rejected(session, { agent: { handled: 1 }, questions: [{ id: "Q1", status: "answered", answer: { kind: "accept" } }] }, /Q1/);
  rejected(session, { questions: [{ id: "q9", round: 3, title: "No rec" }] }, /q9.*rec/);
  rejected(session, { questions: [{ id: "q9", title: "No round", rec: { option: "A" } }] }, /q9.*round/);
  rejected(session, { questions: [{ status: "open" }] }, /id/);
});

test("patch: thread and visual.queued append; appended messages without at get the current time", () => {
  const m = (who, text, at = T0) => ({ who, text, at });
  const session = seeded({
    questions: [qn("q1", 1, { thread: [m("user", "first")] })],
    visual: { kind: "diagram", version: 1, at: T0, thread: [m("agent", "v1 drawn")], drawing: { since: T0, seq: 1 }, queued: ["feedback: bigger"] },
  });
  const t1 = Date.now();
  applied(session, {
    questions: [{ id: "q1", thread: [m("user", "why?", "2026-09-01T10:05:00.000Z"), { who: "agent", text: "because" }] },
      { id: "q2", round: 2, title: "New", rec: { text: "t", why: "w" }, thread: [{ who: "agent", text: "context" }] }],
    visual: { thread: [{ who: "user", text: "smaller" }], queued: ["feedback: smaller"] },
  });
  const t2 = Date.now();
  const st = stateOf(session);
  const within = (at) => { assert.match(at, ISO); const t = Date.parse(at); assert.ok(t >= t1 - 1000 && t <= t2 + 1000, at); };
  const th = st.questions[0].thread;
  assert.deepEqual(th.slice(0, 2), [m("user", "first"), m("user", "why?", "2026-09-01T10:05:00.000Z")], "existing kept, given at kept");
  assert.equal(th.length, 3);
  assert.equal(th[2].text, "because"); within(th[2].at);
  within(st.questions[1].thread[0].at);
  assert.deepEqual(st.visual.thread[0], m("agent", "v1 drawn"));
  assert.equal(st.visual.thread[1].text, "smaller"); within(st.visual.thread[1].at);
  assert.deepEqual(st.visual.queued, ["feedback: bigger", "feedback: smaller"]);
  assert.deepEqual(st.visual.drawing, { since: T0, seq: 1 }, "the rest of visual is kept");
  rejected(session, { questions: [{ id: "q1", thread: { who: "user", text: "not a list" } }] }, /thread/);
  rejected(session, { visual: { queued: "not a list" } }, /queued/);
});

test("patch: the server stamps the times the agent leaves out; an explicit time in the patch always wins", () => {
  const rows = [{ option: "A", pros: ["p"], cons: ["c"] }];
  const session = seeded({
    agent: { status: "working", since: T0, handled: 2 },
    questions: [qn("q1", 1), qn("q2", 1)],
    visual: { kind: "prototype", version: 1, at: T0, note: "v1", stale: false, thread: [], drawing: { since: T0, seq: 2 } },
  });

  // Left out: agent.since (status given), explore.at (known and new question), a bumped
  // visual's at, the next draw's drawing.since, finished.at.
  let t1 = Date.now();
  applied(session, {
    agent: { status: "waiting", handled: 3 },
    questions: [
      { id: "q1", explore: { rows } },
      { id: "q3", round: 2, title: "New", rec: { text: "t", why: "w" }, explore: { rows } },
    ],
    visual: { version: 2, note: "v2: bigger", drawing: { seq: 3 } },
    finished: { doc: "docs/x-design.md" },
  });
  let t2 = Date.now();
  let st = stateOf(session);
  stampedBetween(st.agent.since, t1, t2, "agent.since");
  assert.equal(st.agent.status, "waiting");
  assert.equal(st.agent.handled, 3);
  stampedBetween(st.questions[0].explore.at, t1, t2, "q1.explore.at");
  assert.deepEqual(st.questions[0].explore.rows, rows);
  stampedBetween(st.questions[2].explore.at, t1, t2, "q3.explore.at (new question)");
  stampedBetween(st.visual.at, t1, t2, "visual.at on a version bump");
  assert.equal(st.visual.version, 2);
  stampedBetween(st.visual.drawing.since, t1, t2, "visual.drawing.since");
  assert.equal(st.visual.drawing.seq, 3);
  stampedBetween(st.finished.at, t1, t2, "finished.at");
  assert.equal(st.finished.doc, "docs/x-design.md");

  // Given: every explicit time is kept as written.
  const at = (m) => `2026-09-01T12:0${m}:00.000Z`;
  applied(session, {
    agent: { status: "working", since: at(1) },
    questions: [{ id: "q2", explore: { at: at(2), rows } }],
    visual: { version: 3, at: at(3), drawing: { since: at(4), seq: 4 } },
    finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html", at: at(5) },
  });
  st = stateOf(session);
  assert.equal(st.agent.since, at(1));
  assert.equal(st.questions[1].explore.at, at(2));
  assert.equal(st.visual.at, at(3));
  assert.equal(st.visual.drawing.since, at(4));
  assert.equal(st.finished.at, at(5));

  // Not asked for: no status, an unchanged version, no drawing, no explore → nothing restamped.
  const before = stateOf(session);
  applied(session, { agent: { handled: 5 }, visual: { version: 3, stale: true }, questions: [{ id: "q2", status: "deferred" }] });
  st = stateOf(session);
  assert.equal(st.agent.since, before.agent.since, "agent.since kept when the patch gives no status");
  assert.equal(st.visual.at, before.visual.at, "visual.at kept when the version does not change");
  assert.deepEqual(st.visual.drawing, before.visual.drawing, "drawing untouched");
  assert.deepEqual(st.questions[1].explore, before.questions[1].explore, "explore untouched");
  assert.deepEqual(st.finished, before.finished, "finished untouched");

  // finished is still replaced whole: re-given without at, it is stamped anew.
  t1 = Date.now();
  applied(session, { finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html" } });
  t2 = Date.now();
  stampedBetween(stateOf(session).finished.at, t1, t2, "finished.at when finished is re-given");
});

test("patch: null deletes a key at any level", () => {
  const session = seeded({
    note: "every branch settled",
    questions: [qn("q1", 1, { status: "answered", answer: { kind: "accept" } }), qn("q2", 1)],
    visual: { kind: "prototype", version: 3, at: T0, note: "v3", stale: false, drawing: { since: T0, seq: 5 }, queued: ["a"], thread: [] },
  });
  applied(session, { note: null, questions: [{ id: "q1", status: "reopened", answer: null }], visual: { drawing: null, queued: null } });
  let st = stateOf(session);
  assert.ok(!("note" in st));
  assert.ok(!("answer" in st.questions[0]));
  assert.equal(st.questions[0].status, "reopened");
  assert.deepEqual(st.visual, { kind: "prototype", version: 3, at: T0, note: "v3", stale: false, thread: [] });
  applied(session, { visual: null, note: "The draw failed; click Visualize to try again." });
  st = stateOf(session);
  assert.ok(!("visual" in st));
  assert.equal(st.note, "The draw failed; click Visualize to try again.");
});

test("patch: terms are keyed by term; a known term is replaced whole, a new one appended", () => {
  const session = seeded({ terms: [{ term: "round", def: "One turn of questions.", avoid: ["batch"] }, { term: "send", def: "One press.", avoid: [] }] });
  applied(session, { terms: [{ term: "round", def: "The frontier of one turn." }, { term: "frontier", def: "Askable now.", avoid: ["queue"] }] });
  assert.deepEqual(stateOf(session).terms, [
    { term: "round", def: "The frontier of one turn." },
    { term: "send", def: "One press.", avoid: [] },
    { term: "frontier", def: "Askable now.", avoid: ["queue"] },
  ]);
  rejected(session, { terms: [{ def: "no term" }] }, /term/);
});

test("patch: invalid JSON, a failed validation, a bad shape, or a missing state.json exits non-zero with one stderr line and leaves state.json untouched", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  rejected(session, "{ nope", /JSON/);
  rejected(session, "", /empty/);
  rejected(session, "[1,2]", /object/);
  rejected(session, '"just a string"', /object/);
  rejected(session, { agent: { status: "sleeping" } }, /agent\.status/);
  rejected(session, { agent: { handled: -1 } }, /agent\.handled/);
  rejected(session, { agent: "waiting" }, /agent/);
  rejected(session, { questions: null }, /questions/);
  rejected(session, { questions: { id: "q1" } }, /questions/);
  rejected(session, { questions: [{ id: "q1", status: "done" }] }, /q1.*status/);
  rejected(session, { questions: [{ id: "q1", answer: { kind: "maybe" } }] }, /q1.*answer/);
  rejected(session, { questions: [{ id: "q1", thread: [{ who: "bot", text: "hi" }] }] }, /q1.*thread/);
  rejected(session, { visual: { kind: "painting" } }, /visual\.kind/);
  rejected(session, { visual: { stale: true } }, /visual needs kind and version/);
  rejected(session, { terms: "round" }, /terms/);
  rejected(session, '{"questions":null,"__proto__":{"questions":[]}}', /__proto__.*the patch/);
  rejected(session, '{"agent":{"status":null,"__proto__":{"status":"waiting"}}}', /__proto__.*agent/);
  rejected(session, '{"questions":[{"id":"q1","status":null,"__proto__":{"status":"open"}}]}', /__proto__.*q1/);
  rejected(session, '{"questions":[{"id":"q9","round":2,"title":"t","rec":{"why":"w"},"__proto__":{"status":"answered"}}]}', /__proto__.*q9/);

  const empty = tmp("grill-nostate-");
  const r = patch(empty, { note: "x" });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /^grill: [^\n]*state\.json[^\n]*\n$/);
  assert.deepEqual(readdirSync(empty), [], "nothing created");
});

test("patch: an error the merge never expected keeps the contract — one grill: line, exit 2, state.json untouched", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  // Deep nesting overflows the stack in the recursive clean, which is a RangeError, not a
  // PatchError (3000 levels is already enough here; 20000 is far past it and still runs in ms).
  const deep = `{"extra":${"[".repeat(20000)}${"]".repeat(20000)}}`;
  const r = rejected(session, deep, /could not apply the patch \(state\.json unchanged\)/);
  assert.equal(r.code, 2, "the same exit code as every other rejection");
});

test("patch: every field the page renders must have the shape the render reads, or the patch is rejected", () => {
  const session = seeded({
    terms: [{ term: "round", def: "One turn of questions.", avoid: ["batch"] }],
    questions: [qn("q1", 1, { explore: { at: T0, rows: [{ option: "A", pros: ["p"], cons: ["c"] }] } })],
    visual: { kind: "prototype", version: 1, at: T0, note: "v1", stale: false, thread: [] },
  });
  // The page renders each term as esc(t.def) and t.avoid.map(esc): a string avoid has a
  // length but no map, and freezes the page.
  rejected(session, { terms: [{ term: "round", def: "d", avoid: "batch" }] }, /round.*avoid/);
  rejected(session, { terms: [{ term: "round", def: "d", avoid: [["batch"]] }] }, /round.*avoid/);
  rejected(session, { terms: [{ term: "round", def: ["d"] }] }, /round.*def/);
  // Each explore row is read as r.option, r.pros, r.cons: a null row throws.
  const ex = (rows, at) => ({ questions: [{ id: "q1", explore: { ...(at === undefined ? {} : { at }), rows } }] });
  rejected(session, ex([null]), /q1\.explore\.rows\[0\]/);
  rejected(session, ex(["A"]), /q1\.explore\.rows\[0\]/);
  rejected(session, ex([{ option: "A", pros: "fast", cons: ["c"] }]), /q1\.explore\.rows\[0\]\.pros/);
  rejected(session, ex([{ option: "A", pros: ["p"], cons: [{ text: "c" }] }]), /q1\.explore\.rows\[0\]\.cons/);
  rejected(session, ex([{ option: 1, pros: ["p"], cons: ["c"] }]), /q1\.explore\.rows\[0\]\.option/);
  rejected(session, ex([], 12), /q1\.explore\.at/);
  // Text the page puts on screen goes through String(): an object whose own toString is not a
  // function throws there ("Cannot convert object to primitive value"), so rendered text must be text.
  const boom = { toString: "x" };
  rejected(session, { questions: [{ id: "q1", options: [{ k: "A", text: boom }] }] }, /q1\.options/);
  rejected(session, { questions: [{ id: "q1", rec: { option: "A", why: boom } }] }, /q1\.rec\.why/);
  rejected(session, { questions: [{ id: "q1", rec: { option: ["A"], why: "w" } }] }, /q1\.rec\.option/);
  rejected(session, { questions: [{ id: "q1", rec: { text: 5, why: "w" } }] }, /q1\.rec\.text/);
  rejected(session, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", option: 2 } }] }, /q1\.answer\.option/);
  rejected(session, { questions: [{ id: "q1", status: "answered", answer: { kind: "text", text: boom } }] }, /q1\.answer\.text/);
  // A multi question's sets are mapped as lists of letters: a string set or a non-string letter throws.
  rejected(session, { questions: [{ id: "q1", multi: "yes" }] }, /q1\.multi/);
  rejected(session, { questions: [{ id: "q1", rec: { options: "A", why: "w" } }] }, /q1\.rec\.options/);
  rejected(session, { questions: [{ id: "q1", status: "answered", answer: { kind: "option", options: ["A", 2] } }] }, /q1\.answer\.options/);
  rejected(session, { visual: { note: boom } }, /visual\.note/);
  rejected(session, { visual: { version: 2, at: 5 } }, /visual\.at/);
  rejected(session, { visual: { drawing: { since: boom, seq: 2 } } }, /visual\.drawing/);
  rejected(session, { finished: { doc: boom } }, /finished\.doc/);
  rejected(session, { finished: { doc: "docs/x.md", visual: 1 } }, /finished\.visual/);
  rejected(session, { finished: { doc: "docs/x.md", at: boom } }, /finished\.at/);

  // Every shape SKILL.md documents still goes through, including the optional parts left out.
  applied(session, {
    terms: [{ term: "round", def: "d", avoid: [] }, { term: "send", def: "One press." }],
    questions: [
      { id: "q1", status: "answered", answer: { kind: "text", text: "Neither, a third way" }, rec: { text: "t", why: "w" },
        explore: { rows: [{ option: "A", pros: ["p"], cons: [] }, { option: "B", pros: [], cons: ["c"] }] } },
      { id: "q2", round: 2, title: "No options", body: "b", rec: { why: "only a why" } },
      { id: "q3", round: 2, title: "Multi", body: "b", multi: true, options: [{ k: "A", text: "a" }, { k: "B", text: "b" }],
        rec: { options: ["A", "B"], why: "w" }, status: "answered", answer: { kind: "accept", options: ["A", "B"] } },
    ],
    visual: { version: 2, note: "v2: bigger", drawing: { seq: 3 } },
    finished: { doc: "docs/x-design.md", visual: "docs/x-visual.html" },
  });
});

// ---- importance levels and option ratings (docs/importance-and-ratings-design.md) ----
const rated = (ux, correct, risk, cost) => ({ ux, correct, risk, cost });
const ratedOpts = () => [
  { k: "A", text: "Alpha", ratings: rated("good", "good", "mixed", "good") },
  { k: "B", text: "Beta", ratings: rated("mixed", "poor", "good", "na") },
];

test("patch: old sessions without axes, levels or ratings pass untouched; new questions get no level by default", () => {
  const session = seeded({ questions: [qn("q1", 1, { durable: true })] });
  assert.ok(!("axes" in stateOf(session)), "new writes no axes: absent means the default four");
  applied(session, { note: "still fine", questions: [{ id: "q2", round: 2, title: "Plain", rec: { option: "A", why: "w" }, options: [{ k: "A", text: "a" }] }] });
  const st = stateOf(session);
  assert.ok(!("axes" in st));
  for (const q of st.questions) {
    for (const k of ["level", "levelReason"]) assert.ok(!(k in q), `${q.id} gets no ${k} by default`);
    for (const o of q.options) assert.ok(!("ratings" in o), `${q.id}.${o.k} gets no ratings by default`);
  }
  assert.equal(st.questions[0].durable, true, "durable stays in state");
});

test("patch: a question's level and levelReason, and each option's ratings on the default axes", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  applied(session, { questions: [
    { id: "q1", level: "careful", levelReason: "high stakes, close call", options: ratedOpts() },
    { id: "q2", round: 1, title: "Skim one", rec: { option: "A", why: "w" }, level: "skim", levelReason: "low stakes",
      options: [{ k: "A", text: "a", ratings: { ux: "good" } }, { k: "B", text: "b", ratings: {} }] },
    { id: "q3", round: 1, title: "Check one", rec: { option: "A", why: "w" }, level: "check", levelReason: "high stakes, clear answer", options: [{ k: "A", text: "a" }] },
    { id: "q4", round: 1, title: "Taste", rec: { option: "B", why: "calmer" }, level: "yours", levelReason: "taste; no axis separates the options",
      options: [{ k: "A", text: "Not synced" }, { k: "B", text: "Local only" }] },
  ] });
  const st = stateOf(session);
  assert.equal(st.questions[0].level, "careful");
  assert.equal(st.questions[0].levelReason, "high stakes, close call");
  assert.deepEqual(st.questions[0].options[1].ratings, rated("mixed", "poor", "good", "na"));
  assert.deepEqual(st.questions[1].options[0].ratings, { ux: "good" }, "an axis left out is allowed (no chip)");
  assert.deepEqual(st.questions.map((q) => q.level), ["careful", "skim", "check", "yours"]);

  rejected(session, { questions: [{ id: "q1", level: "urgent" }] }, /q1\.level must be one of skim\|check\|careful\|yours/);
  rejected(session, { questions: [{ id: "q1", level: "Careful" }] }, /q1\.level/);
  rejected(session, { questions: [{ id: "q1", levelReason: 5 }] }, /q1\.levelReason must be a string/);
  // a level needs its reason line
  rejected(session, { questions: [{ id: "q1", levelReason: null }] }, /q1\.levelReason/);
  rejected(session, { questions: [{ id: "q1", levelReason: "  " }] }, /q1\.levelReason/);
  const bad = (ratings) => ({ questions: [{ id: "q1", options: [{ k: "A", text: "Alpha", ratings }] }] });
  rejected(session, bad({ speed: "good" }), /q1\.options\[0\]\.ratings.*speed.*not an axis.*ux, correct, risk, cost/);
  rejected(session, bad({ ux: "great" }), /q1\.options\[0\]\.ratings\.ux must be one of good\|mixed\|poor\|na/);
  rejected(session, bad(["good"]), /q1\.options\[0\]\.ratings must be an object/);
  rejected(session, bad("good"), /q1\.options\[0\]\.ratings must be an object/);
  // A Your-call question carries no ratings: the axes do not separate its options.
  rejected(session, { questions: [{ id: "q4", options: [{ k: "A", text: "Not synced", ratings: { ux: "good" } }, { k: "B", text: "Local only" }] }] },
    /q4 is a Your-call question.*ratings/);
  // moving a rated question to yours means dropping its ratings in the same patch
  rejected(session, { questions: [{ id: "q1", level: "yours" }] }, /q1 is a Your-call question.*ratings/);
  applied(session, { questions: [{ id: "q1", level: "yours", levelReason: "taste", options: [{ k: "A", text: "Alpha" }, { k: "B", text: "Beta" }] }] });
  assert.equal(stateOf(session).questions[0].level, "yours");
});

test("patch: axes replace the default set; ratings must use the grill's axis keys", () => {
  const session = seeded({ questions: [qn("q1", 1, { level: "check", levelReason: "high stakes, clear answer", options: ratedOpts() })] });
  // Swapping the axes under existing ratings fails: those ratings name axes that would no longer exist.
  rejected(session, { axes: [{ key: "reach", name: "Reach" }, { key: "spend", name: "Spend" }] }, /q1\.options\[0\]\.ratings.*ux.*not an axis.*reach, spend/);

  const fresh = seeded({ questions: [] });
  applied(fresh, { axes: [{ key: "reach", name: "Reach" }, { key: "spend", name: "Ad spend" }], questions: [
    { id: "q1", round: 1, title: "Channel", rec: { option: "A", why: "w" }, level: "careful", levelReason: "high stakes, close call",
      options: [{ k: "A", text: "Email", ratings: { reach: "mixed", spend: "good" } }, { k: "B", text: "Ads", ratings: { reach: "good", spend: "poor" } }] },
  ] });
  assert.deepEqual(stateOf(fresh).axes, [{ key: "reach", name: "Reach" }, { key: "spend", name: "Ad spend" }]);
  rejected(fresh, { questions: [{ id: "q1", options: [{ k: "A", text: "Email", ratings: { ux: "good" } }] }] }, /ux.*not an axis.*reach, spend/);

  rejected(fresh, { axes: [] }, /axes must be a non-empty array/);
  rejected(fresh, { axes: "ux" }, /axes must be a non-empty array/);
  rejected(fresh, { axes: [{ key: "reach" }, { key: "spend", name: "Spend" }] }, /axes\[0\].*key.*name/);
  rejected(fresh, { axes: [{ key: "", name: "Blank" }] }, /axes\[0\]/);
  rejected(fresh, { axes: [{ key: "reach", name: "Reach" }, { key: "reach", name: "Reach again" }] }, /axis key reach appears twice/);
  applied(fresh, { axes: null, questions: [{ id: "q1", options: [{ k: "A", text: "Email" }, { k: "B", text: "Ads" }] }] });
  assert.ok(!("axes" in stateOf(fresh)), "axes: null goes back to the default four");
});

test("patch: axes keep their names, keys and order while ratings remain", () => {
  const defaults = [{ key: "ux", name: "User experience" }, { key: "correct", name: "Technical correctness" }, { key: "risk", name: "Risk" }, { key: "cost", name: "Cost" }];
  const session = seeded({ questions: [qn("q1", 1, { options: ratedOpts() })] });
  const stable = /axes cannot change while ratings remain/;
  rejected(session, { axes: defaults.map((a) => ({ ...a, name: `New ${a.name}` })) }, stable);
  rejected(session, { axes: [...defaults, { key: "reach", name: "Reach" }] }, stable);
  rejected(session, { axes: defaults.toReversed() }, stable);
  applied(session, { axes: defaults.map(({ key, name }) => ({ name, key })) });
  applied(session, { axes: null });
  assert.ok(!("axes" in stateOf(session)));

  const axes = [{ key: "ux", name: "Ease of use" }, { key: "reach", name: "Reach" }];
  const custom = seeded({ questions: [] });
  applied(custom, { axes, questions: [qn("q1", 1, { options: [{ k: "A", text: "Alpha", ratings: { ux: "good" } }] })] });
  rejected(custom, { axes: axes.map((a) => ({ ...a, name: `New ${a.name}` })) }, stable);
  rejected(custom, { axes: [...axes, { key: "cost", name: "Cost" }] }, stable);
  rejected(custom, { axes: axes.slice(0, 1) }, stable);
  rejected(custom, { axes: null }, stable);
  rejected(custom, { axes: defaults, questions: [{ id: "q1", options: ratedOpts() }] }, stable);
  applied(custom, { axes: axes.map(({ key, name }) => ({ name, key })) });
  applied(custom, { axes: null, questions: [{ id: "q1", options: [{ k: "A", text: "Alpha" }] }] });
  assert.ok(!("axes" in stateOf(custom)));
});

test("patch: a stdin that cannot be read exits non-zero with one stderr line and leaves state.json untouched", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  const before = rawState(session);
  // A directory as stdin: not a TTY, and reading it fails with EISDIR on every platform we run on.
  const fd = openSync(tmp("grill-stdin-dir-"), "r");
  let r;
  try { r = spawnSync(process.execPath, [SERVER, "patch", "--session", session], { env, stdio: [fd, "pipe", "pipe"], encoding: "utf8" }); } finally { closeSync(fd); }
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "", "nothing on stdout");
  assert.match(r.stderr, /^grill: [^\n]*stdin[^\n]*\n$/, `exactly one grill: line on stderr, got: ${r.stderr}`);
  assert.equal(rawState(session), before, "state.json untouched");
  assert.deepEqual(leftovers(session), [], "no temp file left behind");
});

test("patch: a patch that reaches stdin after the server has started reading is still applied", async () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  const child = spawn(process.execPath, [SERVER, "patch", "--session", session], { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise((res) => child.on("exit", res));
  // Late enough that the server is already blocked reading an empty stdin, as with a slow writer on a pipe.
  await sleep(500);
  child.stdin.end(JSON.stringify({ agent: { handled: 4 } }));
  assert.equal(await exited, 0, `patch failed: ${err}`);
  assert.equal(err, "");
  assert.equal(JSON.parse(out).handled, 4);
  assert.equal(stateOf(session).agent.handled, 4);
});

test("patch: --file reads the patch from a file instead of stdin", () => {
  const session = seeded({ questions: [qn("q1", 1)] });
  const file = join(tmp("grill-pf-"), "patch.json");
  writeFileSync(file, JSON.stringify({ agent: { handled: 7 }, questions: [{ id: "q1", status: "deferred" }] }));
  const r = applied(session, undefined, ["--file", file]);
  assert.equal(JSON.parse(r.out).handled, 7);
  assert.equal(stateOf(session).questions[0].status, "deferred");
  rejected(session, undefined, /no-such/, ["--file", join(tmp("grill-pf-"), "no-such.json")]);
});

test("patch round trip: new → patch round 1 → serve → POST /send → patch the handling → GET /state reflects it", async (t) => {
  const { session } = newSession(tmp("grill-rt-"), "Round trip");
  // The patches below are the SKILL.md shapes, with no times in them: the server stamps them.
  const r1 = applied(session, {
    agent: { status: "waiting" },
    terms: [{ term: "send", def: "One press of Send to Agent.", avoid: ["submit"] }],
    questions: [
      { id: "q1", round: 1, title: "Storage", body: "Where state lives.", options: [{ k: "A", text: "Files" }, { k: "B", text: "SQLite" }], rec: { option: "A", why: "No dependency." } },
      { id: "q2", round: 1, title: "Transport", body: "How the page talks.", options: [{ k: "A", text: "Polling" }, { k: "B", text: "SSE" }], rec: { option: "A", why: "Simplest." } },
    ],
  });
  assert.deepEqual(JSON.parse(r1.out), { ok: true, questions: 2, open: 2, handled: 0, bytes: statSync(join(session, "state.json")).size });

  const s = await startServe(session); t.after(s.stop);
  let st = await (await fetch(s.ready.url + "state")).json();
  assert.deepEqual(st.questions.map((q) => [q.id, q.status]), [["q1", "open"], ["q2", "open"]]);
  assert.equal(st.agent.status, "waiting");

  const actions = [{ q: "q1", type: "answer", kind: "accept" }, { q: "q2", type: "thread", text: "Why not SSE?" }];
  assert.deepEqual(await (await post(s.ready.url, { actions })).json(), { ok: true, seq: 1 });
  const ev = JSON.parse(await s.out.nth(2));

  applied(session, { agent: { status: "working" } });
  const working = (await (await fetch(s.ready.url + "state")).json()).agent;
  assert.equal(working.status, "working");
  assert.match(working.since, ISO);
  assert.ok(Date.parse(working.since) >= Date.parse(ev.at), `agent.since (${working.since}) stamped when work began, after the send (${ev.at})`);

  const r2 = applied(session, {
    agent: { status: "waiting", handled: ev.seq },
    questions: [
      { id: "q1", status: "answered", answer: { kind: "accept" } },
      { id: "q2", thread: [{ who: "user", text: "Why not SSE?", at: ev.at }, { who: "agent", text: "Polling survives a server restart with no reconnect logic." }] },
      { id: "q3", round: 2, deps: ["q1"], title: "File layout", body: "With files settled in Q1.", options: [{ k: "A", text: "One folder" }], rec: { option: "A", why: "Easy to find." } },
    ],
  });
  assert.deepEqual(JSON.parse(r2.out), { ok: true, questions: 3, open: 2, handled: 1, bytes: statSync(join(session, "state.json")).size });

  st = await (await fetch(s.ready.url + "state")).json();
  assert.deepEqual(st.agent.handled, 1);
  assert.equal(st.agent.status, "waiting");
  assert.ok(Date.parse(st.agent.since) >= Date.parse(working.since), "agent.since restamped when waiting began");
  assert.deepEqual(st.questions.map((q) => [q.id, q.status, q.round]), [["q1", "answered", 1], ["q2", "open", 1], ["q3", "open", 2]]);
  assert.deepEqual(st.questions[0].answer, { kind: "accept" });
  assert.deepEqual(st.questions[1].thread.map((m) => m.who), ["user", "agent"]);
  assert.match(st.questions[1].thread[1].at, ISO);
  assert.equal(st.terms[0].term, "send");
  assert.equal(run(["pending", "--session", session]), "", "nothing left to replay");
});

test("cli: an unknown subcommand prints usage and exits 2, including inherited names like toString", () => {
  for (const name of ["bogus", "toString", "__proto__", "constructor"]) {
    const r = spawnSync(process.execPath, [SERVER, name], { encoding: "utf8", env });
    assert.equal(r.status, 2, `${name} must exit 2`);
    assert.equal(r.stdout, "", `${name} must print nothing on stdout`);
    assert.match(r.stderr, /^grill: usage: server\.mjs [^\n]+\n$/, `${name} must print one usage line`);
  }
});

test("serve: loopback by default — no lanUrl in ready or server.json, url prints one line", async (t) => {
  const { session } = newSession(tmp("grill-loop-"));
  const s = await startServe(session); t.after(s.stop);
  assert.ok(!("lanUrl" in s.ready), "no LAN URL promised when listening on loopback only");
  const info = JSON.parse(readFileSync(join(session, "server.json"), "utf8"));
  assert.ok(!("lanUrl" in info));
  assert.equal(info.host, "127.0.0.1");
  assert.equal(run(["url", "--session", session]), s.ready.url);
});

test("serve --lan: ready and server.json carry a tokenized LAN URL; the LAN origin is accepted", async (t) => {
  const all = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
  if (!all.length) { t.skip("no LAN IPv4 interface on this machine"); return; }
  const rfc1918 = (ip) => ip.startsWith("10.") || ip.startsWith("192.168.") || (() => { const m = ip.match(/^172\.(\d+)\./); return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31; })();
  const expected = all.find(rfc1918) || all[0]; // RFC 1918 first, so a Tailscale 100.x never wins over Wi-Fi
  const { session } = newSession(tmp("grill-lan-"));
  const s = await startServe(session, ["--lan"]); t.after(s.stop);
  assert.match(s.ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, "the primary URL stays localhost");
  assert.match(s.ready.lanUrl, new RegExp(`^http://${expected.replace(/\./g, "\\.")}:\\d+/\\?t=[0-9a-f]{32}$`), "the LAN URL carries a 128-bit token and prefers RFC 1918");
  const info = JSON.parse(readFileSync(join(session, "server.json"), "utf8"));
  assert.equal(info.lanUrl, s.ready.lanUrl);
  assert.equal(info.host, "0.0.0.0");

  const token = new URL(s.ready.lanUrl).searchParams.get("t");
  const lanBase = s.ready.lanUrl.replace(/\/\?t=.*$/, "/");
  const lan = (p, tok = token) => lanBase + p + (tok ? `?t=${tok}` : "");
  const lanOrigin = new URL(s.ready.lanUrl).origin;

  assert.equal((await fetch(s.ready.url + "state")).status, 200, "localhost still serves without a token");
  assert.equal((await fetch(lan("state"))).status, 200, "the LAN URL serves with the token");
  assert.equal((await fetch(lanBase + "state")).status, 403, "the LAN address without a token is rejected");
  assert.equal((await fetch(lan("state", "wrong"))).status, 403, "a wrong token is rejected");
  const actions = [{ q: "q1", type: "defer" }];
  const sendAs = (url, origin) => fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ actions }) });
  assert.equal((await sendAs(lan("send"), lanOrigin)).status, 200, "the LAN origin is accepted with the token");
  assert.equal((await sendAs(lanBase + "send", lanOrigin)).status, 403, "a tokenless LAN send is rejected, curl included");
  // The token is the authentication in LAN mode, so a valid one skips the Origin allowlist: the
  // page opened as http://<name>.local:<port>/?t=… must be able to send. Token-less requests keep it.
  const port = new URL(s.ready.url).port;
  const dotLocal = `http://my-mac.local:${port}`;
  assert.equal((await sendAs(lan("send"), dotLocal)).status, 200, "a .local origin with the token is accepted");
  assert.equal((await sendAs(`${s.ready.url}send?t=${token}`, dotLocal)).status, 200, "a valid token skips the allowlist on loopback too");
  assert.equal((await sendAs(`${s.ready.url}send?t=wrong`, dotLocal)).status, 403, "a wrong token does not skip the allowlist");
  assert.equal((await sendAs(lan("send"), "null")).status, 403, "the sandboxed visual iframe has the token in its src, so an opaque origin stays rejected");
  assert.equal((await sendAs(s.ready.url + "send", dotLocal)).status, 403, "a token-less request keeps the Origin allowlist");
  assert.equal((await sendAs(s.ready.url + "send", "https://evil.example")).status, 403, "a foreign origin is still rejected on loopback");
  const themeAs = (url, origin) => fetch(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ theme: "system" }) });
  assert.equal((await themeAs(lan("theme"), dotLocal)).status, 200, "the theme toggle works from a .local origin with the token");
  assert.equal((await themeAs(lan("theme"), "null")).status, 403, "and rejects the iframe's opaque origin");
  assert.equal((await themeAs(lanBase + "theme", lanOrigin)).status, 403, "a tokenless LAN theme write is rejected");
  assert.equal((await fetch(lanBase)).status, 403, "the LAN page without a token is rejected");
  assert.equal((await fetch(lan("", token))).status, 200, "the LAN page serves with the token");
  assert.equal((await fetch(lanBase + "events")).status, 403, "LAN /events without a token is rejected");
  assert.equal((await fetch(lan("events"))).status, 200, "LAN /events serves with the token");
  assert.equal((await fetch(lanBase + "visual")).status, 403, "LAN /visual without a token is rejected");
  assert.equal((await fetch(lan("visual"))).status, 404, "LAN /visual with the token passes the gate (404, no visual yet)");
  await s.out.nth(4); // ready + the three accepted sends

  assert.deepEqual(run(["url", "--session", session, "--all"]).split("\n"), [s.ready.url, s.ready.lanUrl], "url --all prints both");
  assert.equal(run(["url", "--session", session]), s.ready.url, "plain url still prints one line");
});

test("serve --lan: the Host check admits the LAN host, and any Host with a valid token on a LAN socket; loopback keeps its allowlist", async (t) => {
  const lanIps = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal);
  if (!lanIps.length) { t.skip("no LAN IPv4 interface on this machine"); return; }
  const { session } = newSession(tmp("grill-lan-host-"));
  const s = await startServe(session, ["--lan"]); t.after(s.stop);
  const lan = new URL(s.ready.lanUrl);
  const token = lan.searchParams.get("t");
  const port = lan.port;
  const lanBase = `http://${lan.host}/`;
  const dotLocal = `my-mac.local:${port}`;
  const send = JSON.stringify({ actions: [{ q: "q1", type: "defer" }] });

  assert.equal((await raw(lanBase, { path: `/state?t=${token}` })).status, 200, "the printed LAN host passes the Host check");
  for (const p of ["/", "/state", "/events"]) {
    assert.equal((await raw(lanBase, { path: `${p}?t=${token}`, host: dotLocal })).status, 200, `LAN ${p} under a .local Host with the token is served`);
  }
  assert.equal((await raw(lanBase, { method: "POST", path: `/send?t=${token}`, host: dotLocal, body: send, headers: { "content-type": "application/json", origin: `http://${dotLocal}` } })).status, 200, "a .local Send with the token lands");
  for (const [path, host] of [["/state", dotLocal], ["/state?t=wrong", dotLocal], ["/state", lan.host], ["/state", `attacker.example:${port}`]]) {
    assert.equal((await raw(lanBase, { path, host })).status, 403, `LAN ${path} with Host ${host} and no valid token is refused`);
  }
  for (const host of [dotLocal, `attacker.example:${port}`, lan.host.replace(/:\d+$/, `:${Number(port) + 1}`)]) {
    const res = await raw(s.ready.url, { path: `/state?t=${token}`, host });
    assert.equal(res.status, 403, `loopback with Host ${host} is refused even with the token`);
    assert.deepEqual(JSON.parse(res.body), { error: "unrecognized Host header" });
  }
  assert.equal((await raw(s.ready.url, { path: "/state", host: lan.host })).status, 200, "the LAN host is this server, on loopback too");
  await s.out.nth(2);
});

test("serve --host ADDR: the address it prints is an accepted Host", async (t) => {
  const ip = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal);
  if (!ip) { t.skip("no LAN IPv4 interface on this machine"); return; }
  const { session } = newSession(tmp("grill-host-addr-"));
  const s = await startServe(session, ["--host", ip.address]); t.after(s.stop);
  const u = new URL(s.ready.url);
  assert.equal(u.hostname, ip.address);
  assert.equal((await raw(s.ready.url, { path: `/state${u.search}` })).status, 200, "the printed URL is served");
  assert.equal((await raw(s.ready.url, { path: "/state" })).status, 403, "and still needs its token");
});

test("serve: --lan with --host, and --open with --open-command, are rejected with one stderr line", () => {
  const { session } = newSession(tmp("grill-flag-"));
  for (const extra of [["--lan", "--host", "127.0.0.1"], ["--lan", "--host"], ["--host"], ["--open", "--open-command", "true"]]) {
    const r = spawnSync(process.execPath, [SERVER, "serve", "--session", session, ...extra], { encoding: "utf8", env });
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, "", "nothing on stdout when the flags conflict");
    assert.match(r.stderr, /^grill: [^\n]+\n$/, "exactly one grill: line on stderr");
  }
});

test("serve --open-command: the program runs with the live URL and the stdout protocol is untouched", async (t) => {
  const dir = tmp("grill-open-");
  const seen = join(dir, "opened.txt");
  const probe = join(dir, "probe.mjs");
  writeFileSync(probe, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(seen)}, process.argv[2] + "\\n");\n`);
  chmodSync(probe, 0o755);
  const { session } = newSession(dir);
  const s = await startServe(session, ["--open-command", probe]); t.after(s.stop);
  assert.match(s.ready.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  await post(s.ready.url, { actions: [{ q: "q1", type: "defer" }] });
  assert.equal(JSON.parse(await s.out.nth(2)).seq, 1, "stdout still carries ready then sends, nothing else");
  if (process.platform === "win32") return; // shebang probes do not execute there; the protocol asserts above are the portable part
  let got = "";
  for (let i = 0; i < 40 && !got; i++) {
    await sleep(250);
    try { got = readFileSync(seen, "utf8").trim(); } catch { /* probe has not run yet */ }
  }
  assert.equal(got, s.ready.url, "the program received the live URL as its argument");
});

// --open goes through the OS opener found on PATH (open / xdg-open), so these tests put a stub
// opener (or none) first on PATH: no real browser ever opens. The server itself is run by absolute
// path, so a PATH without node is fine.
async function serveWithOpen(session, path, extra = ["--open"]) {
  const child = spawn(process.execPath, [SERVER, "serve", "--session", session, ...extra], { env: { ...env, PATH: path }, stdio: ["ignore", "pipe", "pipe"] });
  const out = lineReader(child.stdout);
  let err = ""; child.stderr.on("data", (d) => { err += d; });
  const ready = JSON.parse(await out.nth(1));
  const stop = () => new Promise((res) => { if (child.exitCode !== null) return res(); child.on("exit", res); child.kill(); });
  return { child, ready, out, stop, stderr: () => err };
}
const waitFor = async (cond) => { for (let i = 0; i < 40 && !cond(); i++) await sleep(100); return cond(); };
const opener = process.platform === "darwin" ? "open" : "xdg-open";

test("serve --open: the OS opener receives the live URL; stdout keeps the ready-then-sends protocol", async (t) => {
  if (process.platform === "win32") { t.skip("the Windows opener is cmd /c start, not a PATH stub"); return; }
  const dir = tmp("grill-open-os-");
  const seen = join(dir, "opened.txt");
  writeFileSync(join(dir, opener), `#!/bin/sh\necho "$1" >> ${JSON.stringify(seen)}\n`);
  chmodSync(join(dir, opener), 0o755);
  const { session } = newSession(dir);
  const s = await serveWithOpen(session, dir); t.after(s.stop);
  assert.ok(await waitFor(() => { try { return readFileSync(seen, "utf8").trim() === s.ready.url; } catch { return false; } }), "the stub opener got the URL");
  await post(s.ready.url, { actions: [{ q: "q1", type: "defer" }] });
  assert.equal(JSON.parse(await s.out.nth(2)).seq, 1, "stdout still carries ready then sends, nothing else");
  assert.ok(await waitFor(() => s.stderr() !== ""), "the outcome is reported on stderr");
  assert.equal(s.stderr(), `grill: opened ${s.ready.url} in the browser\n`, "one line, once the opener succeeded");
});

test("serve --open: no opener (headless) or a failing one leaves one stderr note and the server running", async (t) => {
  if (process.platform === "win32") { t.skip("the Windows opener is cmd /c start, not a PATH stub"); return; }
  const empty = tmp("grill-open-none-");
  const failing = tmp("grill-open-fail-");
  writeFileSync(join(failing, opener), "#!/bin/sh\necho 'xdg-open: no method available for opening' >&2\nexit 3\n");
  chmodSync(join(failing, opener), 0o755);
  for (const [why, path] of [["no opener on PATH", empty], ["an opener that exits non-zero", failing]]) {
    const { session } = newSession(tmp("grill-open-h-"));
    const s = await serveWithOpen(session, path); t.after(s.stop);
    assert.ok(await waitFor(() => /could not open/.test(s.stderr())), `${why}: a note on stderr`);
    assert.match(s.stderr(), new RegExp(`^grill: could not open ${s.ready.url.replace(/[.?/]/g, "\\$&")} automatically; open it by hand\n$`), `${why}: exactly one grill: line, naming the URL`);
    assert.equal(s.child.exitCode, null, `${why}: the server keeps running`);
    assert.equal((await fetch(s.ready.url + "state")).status, 200, `${why}: and keeps serving`);
    await post(s.ready.url, { actions: [{ q: "q1", type: "defer" }] });
    assert.equal(JSON.parse(await s.out.nth(2)).seq, 1, `${why}: stdout untouched`);
  }
});
