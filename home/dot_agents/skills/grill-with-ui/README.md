# grill-with-ui

A skill for coding agents that moves a "grilling" design interview out of the terminal and
onto a local browser page. The agent asks its questions as cards, each with lettered options
and a highlighted recommendation. You answer them in any order, defer or reopen them, discuss
any single one in its own thread without losing the rest of the session, and press one
button, **Send to Agent**, to ship everything you staged as a single turn. At the end the
agent writes an exhaustive design doc for the topic.

![A grill in progress: the recommended option accepted on one question, a question asked in
another one's discussion thread, both shipped with one Send, the agent's reply and next round
of questions arriving, a pros and cons table from Explore deeper, a prototype of the design
from Visualize, and that prototype redrawn after one note of feedback](docs/demo.gif)

Above: a recommendation accepted on Q3 and a question asked on Q4 go to the agent as one Send,
and its reply opens the next round. Then one click on **Explore deeper** lays out the pros and
cons of Q6's options, **Visualize** draws the design so far as a prototype, and one note in its
feedback thread redraws it as v2 with the change asked for. Recorded against a real session by
[`design/record-demo.mjs`](design/record-demo.mjs).

Under the hood it is small on purpose: one Node script and one HTML file, no dependencies,
no build step. The agent owns `state.json` and changes it only through
`node server.mjs patch`, sending just what changed as a small JSON patch that the script
merges, validates, and writes atomically; a whole-file rewrite would put the entire state
(60 KB by the end of a long grill) into the agent's context on every turn. The page appends
one line per Send to `events.jsonl`; the server that serves the page is also the process
whose output a persistent Monitor delivers to the agent. In wait mode the agent must keep
its foreground listener active; a page server alone cannot wake an ended agent turn.
Submissions made while the agent is not listening remain queued for resume.

## Install

The skill is a plain [Agent Skills](https://agentskills.io) folder (`SKILL.md` plus one
script and one page), so it installs the same way everywhere: put this folder where your
agent looks for skills, under the name `grill-with-ui`. A symlink keeps `git pull` as the
update path; copying the folder works too. Node 20 or newer is the only requirement.

```sh
git clone https://github.com/jasonku09/grill-with-ui ~/Projects/grill-with-ui
ln -s ~/Projects/grill-with-ui ~/.claude/skills/grill-with-ui   # Claude Code (Cursor reads it too)
ln -s ~/Projects/grill-with-ui ~/.agents/skills/grill-with-ui   # Codex, Gemini CLI, Cursor, Copilot
```

Where each agent looks, and how to start a grill once it is there:

| Agent | User-level folder | Project-level folder | Start a grill |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | `/grill-with-ui <topic>` |
| Codex (CLI, IDE) | `~/.agents/skills/` | `.agents/skills/` | `$grill-with-ui <topic>` |
| Gemini CLI | `~/.gemini/skills/` or `~/.agents/skills/` | `.gemini/skills/` or `.agents/skills/` | say "grill with ui: <topic>"; accept the activation prompt |
| Cursor | `~/.cursor/skills/` or `~/.agents/skills/` (also `~/.claude/skills/`) | `.cursor/skills/` or `.agents/skills/` | `/grill-with-ui <topic>` in Agent chat |
| GitHub Copilot (CLI, VS Code, JetBrains) | `~/.copilot/skills/` or `~/.agents/skills/` | `.github/skills/`, `.claude/skills/`, or `.agents/skills/` | say "grill with ui: <topic>" |
| Any other agent that reads `SKILL.md` | its skills folder | | say "grill with ui: <topic>" |

Paths are from each product's documentation as of September 2026; `/skills` (Codex,
Gemini CLI) or the agent's skill picker will show whether the install landed. The skill's
description names the phrase "grill with ui", so plain language works on every agent.

What the agent needs at run time:

- **A shell tool and Node 20+.** Claude Code is woken per Send by its persistent Monitor
  tool. Agents without one use **wait mode**: `serve --detach` starts the page server,
  and a foreground `wait` loop receives sends. Follow [Wait mode](SKILL.md#wait-mode-agents-without-a-monitor-tool)
  for startup, harness fallback, and turn-boundary requirements.
- **Optionally a subagent tool**, for Visualize. See [Use](#use) for the drawing modes;
  without a subagent tool, the agent draws inline.

## Use

In any project:

```
/grill-with-ui <topic you want grilled>
```

The agent opens the page in your browser and prints its URL too, in case no browser
could be opened (a headless or remote machine). Answer by clicking an option (the recommended one is
outlined) or writing free text. A card marked "Pick one or more" takes any number of
options, and each click toggles one. Start a discussion in the right-hand panel; use **Defer** and **Reopen** on a card when
you want to. Staged actions and typed drafts survive a reload. **Send N to Agent** (⌘↩)
ships staged actions together with text left in any question's discussion or the visual
feedback box, including questions you navigated away from. These notes count toward the
Send total and can enable Send on their own; sending clears their boxes. A free-text answer
is sent only once staged (**Stage text**, or ⌘↩ in its box): until then it stays in its box,
does not count toward Send, and the footer names the question in a warning. If sending fails, carried notes remain
staged and removable. **Explore deeper** next to a question's title goes to
the agent the moment you click it, and the pros and cons table for that question's options
appears in the discussion panel when the agent is done. The agent answers
threads, writes the tables, records your answers, and adds the next round of questions to
the page.

New questions say how much attention they deserve: an **importance level** (Skim, Check, Decide
carefully, or Your call) with a one-line reason; **Levels** in the header explains them. The
question list puts Decide carefully and Your call first within each round and labels only
those two. Under each option a row of chips rates it on user experience, technical
correctness, risk, and cost (green good, yellow mixed, red poor), so the trade-offs read at
a glance; the agent swaps in its own axes at the start only when those clearly do not fit
the topic. Unrated axes and axes that do not apply show no chip. A Your-call question is
taste, so it shows the agent's **My lean** and no chips. Older questions without a level
show no pill; **Levels** is hidden when no question has a level. Rounds without levels
keep their original order; otherwise, unlevelled questions sort with Check, ties use
natural question-id order, and the default open-question selection follows that order.

**Visualize** in the header asks the agent for one picture of the design so far: an
interactive HTML prototype when the topic is a UI, an architecture or flow diagram
otherwise. When the topic is a change to an existing app, the prototype is drawn inside the
real page it changes, with the app's own look. It appears in place of the question list and
card, with its own feedback thread on the right. Undecided parts are drawn from the
recommendations and marked "assumed"; feedback you add there ships with your next Send and
redraws it; a note that contradicts an answered question reopens that question rather than
silently changing your answer. Ordinary answers and question discussions do not regenerate
the visual or delay the next round. When decisions change what it shows, it is marked
**Out of date**; click **Regenerate** to include the latest decisions. Each requested redraw
has a version number and a one-line change note. **Use subagent** is checked by default:
the agent briefs a subagent so hundreds of lines of markup stay out of the interview's
context. The draw runs in the background, so Send keeps working and the interview goes
on while it is drawn; the header says
Visualizing… (or the strip says regenerating…) until the new version lands. Once the
grilling is done, untick **Use subagent** beside Visualize: the agent then draws inline in
its own turn, which is faster, at the cost of the markup landing in its context and Send
waiting until the draw is done. The choice is remembered per grill across reloads and
is read when the request is sent, including for staged feedback. It applies to Visualize,
Regenerate, feedback, and Finish reconciliation when a visual exists.
The checkbox hides when the grill is finished. Finish reconciles and copies the final
visual next to the design doc as
`docs/<topic>-visual.html`.

**Finish grill** sends at once (after an inline confirm), including the same pending items
as Send; the agent writes the design doc to the path shown in the header (default
`docs/<topic>-design.md` in your project) and stops.

To pick up an unfinished grill, in the same project:

```
/grill-with-ui resume
```

If the agent crashed or was closed, sends you made in the meantime are replayed on resume,
and the page tab you still have open reconnects on its own. Resume does not open a second
tab; if you closed yours, open the URL the agent prints.

An unfinished, reachable page shows **No agent is listening · sends will queue until it
resumes** with a hollow amber dot when listener information confirms inactivity and the
agent is not marked as working. A send then reads **Sent #N · queued until an agent listens**.
The warning is hidden when listener information is unavailable; its absence alone does not
guarantee that an agent is listening.

## Files

Session state lives outside your repo, so there is nothing to gitignore:

```
~/.grill-with-ui/
  ui.json        global UI prefs shared by every grill (theme)
  sessions/<project-key>/<YYYYMMDD-HHMMSS>/
    state.json     written only by the agent, through `patch` (questions, recommendations, threads, status)
    events.jsonl   appended only by the page, one line per Send
    server.json    url, port and pid of the running server
    listener.json  heartbeat written by a running `wait`
    serve.log      server output from `serve --detach`
    visual.html    the prototype or diagram, served at /visual
```

`<project-key>` is the git common root of the project with slashes turned into dashes, so
every worktree of a repo sees the same sessions; outside git it is the working directory.

In this repo: `server.mjs` (the server and CLI), `page.html` (the page), `SKILL.md` (the
prompt the agent follows), `test/`, and `design/` + `docs/design.md` (how it was designed).
`design/record-demo.mjs` re-records the GIF above by driving the real page; it needs
Playwright and `ffmpeg`.

## Server commands

```
node server.mjs new      --topic T [--doc P]                  create a session, print its folder
node server.mjs serve    --session DIR [--port N] [--host ADDR | --lan] [--open | --open-command P] [--detach]
                                                          serve the page; print one line per Send
                                                          (--detach: in the background, output in serve.log)
node server.mjs sessions [--all]                               list this project's sessions
node server.mjs pending  --session DIR                         print sends past agent.handled
node server.mjs wait     --session DIR [--after N] [--timeout S]  block until the next send (exit 3 on timeout)
node server.mjs url      --session DIR [--timeout S] [--all]   print the running server's url (--all adds the LAN URL)
node server.mjs patch    --session DIR [--file P]              apply a JSON patch (stdin or P) to state.json
```

Loopback is the default. Pass `--lan` when you answer from a second machine on the
same network: the server listens on the LAN interface and `url` prints the LAN address
next to localhost. Without `--lan` no LAN socket opens and no LAN URL prints, so a grill
never reaches beyond its own machine by accident. LAN mode mints a random per-serve
token and puts it in the LAN URL (`http://<ip>:<port>/?t=<token>`); every request from a
non-loopback address needs it, including `/`, `/state`, `/visual`, `/events`, and `/send`,
while loopback requests work exactly as before. Treat the LAN URL like a password: anyone
with it can read the session and send to the agent, so share it only with the answering
machine. The token is fresh on every serve.

`--open` opens the live page in a browser once the server is listening. The skill passes it
when it starts a grill, not on resume (your open tab reconnects) and not with `--lan` (you
answer from the other machine). It is best effort: without a usable opener a one-line note
goes to stderr, the server keeps running, and stdout carries the same ready-then-sends
lines as ever. `--open-command P` runs `P` with the URL as its argument instead of the OS
opener.

`--detach` runs the same server in the background with its output in `serve.log`, prints
its ready line (with `lanUrl` under `--lan`) once it listens, and exits. Every other flag
goes to the background server, so `--open` opens the page once, from it. A server already
running for the session is reported with `"already": true` instead of doubled, and opens
nothing.

`patch` merges by the rules in `SKILL.md` ("Patching state.json"). A bad patch exits
non-zero and leaves the file untouched; a good one prints one short summary line, never the
state.

By default `serve` listens on 127.0.0.1. Every route requires a Host header matching
`127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` (case-insensitive), or the host of
a URL the server printed (the LAN URL, or the `--host` address); other values receive 403.
The IPv6 spelling is accepted as a header, but the server does not listen on `::1`. This
prevents a web page that points its hostname at your machine (DNS rebinding) from reading
the session. In LAN mode a request from a non-loopback address that carries a valid token
may use any Host, so the page also works opened as `http://<name>.local:<port>/?t=<token>`;
a loopback request never gets that pass. The port is required: avoid `--port 80`, since
browsers omit that default port from Host and are refused. Local clients such as curl
remain trusted: POSTs without an Origin header are allowed after the Host check.

`/visual` is sent with `Content-Security-Policy: sandbox allow-scripts`: its scripts run
with an opaque origin, even when opened in a separate tab. They cannot read the grill's
session responses or submit an accepted Send. This sandbox does not disable networking;
the [visual brief](visual-brief.md#the-file) defines the artifact's offline requirements.
POST bodies over 1 MB on `/send` and `/theme` are refused with 413.

`GRILL_HOME` overrides `~/.grill-with-ui`.

## Tests

```sh
node --test test/server.test.mjs
PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node test/page.e2e.mjs
PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node test/manual-visual.e2e.mjs
PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node test/subagent-toggle.e2e.mjs
PLAYWRIGHT_PKG=/path/to/node_modules/@playwright/test/index.mjs node test/listener.e2e.mjs
```

The page check needs Playwright with Chromium; point `PLAYWRIGHT_PKG` at an existing install
or run it with `@playwright/test` installed next to the repo. It starts a real server on a
throwaway session and drives the page end to end (staging, reload, send, working state,
server restart, finished state).
The manual-visual check covers explicit regeneration and sandbox isolation both in the
iframe and in a separate tab. The focused toggle check covers both drawing modes, the
choice at Send time, and per-grill persistence. The listener check starts a `serve --detach`
server and a real `wait`, and covers the page's "No agent is listening" status appearing,
clearing, and returning. Set `GRILL_EVIDENCE_DIR` to save screenshots and send evidence
from these browser checks.
