# Task: build three static HTML mockups of a "grill session" page

You are working in the repo at the current directory (`grill-with-ui`). Read
`docs/design.md` first for what the product is. Then build three mockup variations of
the page and write them to `design/mockups-codex/` with exactly these names:

- `a-inbox.html`  — inbox layout: a question list on the left (grouped by round), one
  detail card on the right, a sticky bottom bar with the staged count and a Send to Agent
  button.
- `b-scroll.html` — single-column scroll: all question cards in one vertical flow grouped
  by round, an outline rail for jumping between questions, threads expanding inline under
  each card.
- `c-tree.html`   — dependency tree + focus: the design tree (built from each question's
  `deps`) on the left, one focused question card in the middle, and a thread drawer on the
  right.

Do NOT modify anything under `design/mockups/` (an existing set of mockups you must not
read or copy from). Do NOT commit.

## Sample data

Use the data in `design/mockups/data.js` verbatim (it defines a `SESSION` object). You may
read that one file. Inline its contents into each HTML file inside a `<script>` tag so
every file is fully self-contained (no external script tags, no build step, no
frameworks, no dependencies). Vanilla HTML, CSS and JavaScript only.

## Every variation must show, per question

- id, title, body, round number, and links to the questions it depends on (`deps`)
- the lettered options, with the recommended option (`rec.option`) visibly highlighted and
  the rationale (`rec.why`) shown near it
- status (open / answered / deferred), and for answered questions what was chosen, with a
  visible marker when the chosen option differs from the recommendation
- a "durable" marker when `durable` is true and a "recommendation updated" marker when
  `updated` is true
- ways to respond: click an option, a one-click "Accept <rec>" button, and a free-text
  answer box
- a per-question discussion thread showing existing `thread` messages (who + text) and a
  box to add a new message

## Interaction model (page-local state, mocked)

Nothing goes to the agent until the user presses one "Send to Agent" button. Actions the
user takes (option picked, accept clicked, free text staged, thread message added) are
"staged": shown as staged on the page and counted in the Send button label, e.g.
"Send 3 to Agent". Send is disabled when nothing is staged. Pressing Send clears the staged
set, shows a brief confirmation, and flips a visible "agent working / agent waiting"
indicator for a couple of seconds. Also show a "Finish grill" button (no behavior needed)
and the target doc path from `SESSION.doc`.

Focus/select the current open question (`q15`) on load.

## Verification

- Every file must parse and run without console errors. At minimum, run a syntax check of
  each file's scripts with node. If Playwright is available at
  `~/Projects/altitude/apps/web/node_modules/@playwright/test` you may use it from that
  directory to load each file, click one option and add one thread message, and confirm
  the Send button enables with a count; otherwise say you could not run a browser check.
- Finish with a short summary: for each file, the layout and the visual choices you made,
  plus anything you could not verify.
