# Question importance levels and option ratings

grill-with-ui gains two features. First, every question carries an **importance level**:
Skim, Check, Decide carefully, or Your call, with a one-line reason. The level tells you how
much attention the question deserves. Second, every option on a question is rated on four
**axes**: user experience, technical correctness, risk, and cost. The ratings show as
full-word chips tinted green, yellow, or red under the option's text, so the trade-offs and
the quality of the recommendation read at a glance. The sidebar sorts each round by level and
labels only Decide carefully (red) and Your call (purple) rows. A Your-call question shows
"My lean" instead of "Recommended" and has no ratings. The agent's `why` must name the
recommendation's weakest axis. Everything works in light and dark mode. In dark mode the page's
highlight colour becomes a neutral off-white, so red means only "Decide carefully" or a poor
rating. The same grill also triaged the repo's open pull requests and issues. It set the merge
order and decided what else goes into the **next version**. A clickable prototype is in
[importance-and-ratings-visual.html](importance-and-ratings-visual.html); it uses a sample grill
called "Offline sync for the notes app". Its header has a Theme button (system / light / dark)
and a "Sidebar words:" switch. The switch defaults to the decided behaviour, Decide carefully +
Your call.

## Terms

- **axis**: one dimension every option of a question is rated on, like user experience or
  technical correctness. *Avoid:* dimension, criterion, metric.
- **rating**: one option's score on one axis: good, mixed, or poor (or "does not apply").
  *Avoid:* grade, score card.
- **durable**: the existing flag on a question whose decision is hard to reverse, surprising
  without context, and a real trade-off. It decides what goes in the doc's Locked decisions
  section. *Avoid:* important, critical.
- **stakes**: how costly a wrong pick on a question would be: how hard it is to reverse and
  how far the damage reaches. *Avoid:* severity, impact.
- **closeness**: how near the call is between a question's options; a close call is one where
  reasonable people could pick differently. *Avoid:* uncertainty, confidence.
- **importance level**: a question's attention label, one of Skim, Check, Decide carefully,
  or Your call, derived from stakes and closeness and shown with a one-line reason.
  *Avoid:* severity, priority, weight.
- **next version**: the release that ships importance levels and rating chips, plus whatever
  triage items are folded into it. *Avoid:* v2, the update.

## Why

In the user's words: "Not every question has the same weight as others, like some are somewhat
less consequential. I want to see some kind of indicator. The point is, it should tell the
person how much time they should spend or how much they should pay attention to each
question." And: "It would also be nice to rate each recommendation on a few different axes:
user experience, technical correctness, … That way, you can see at a glance what the
trade-offs are and how good a recommendation is."

Before this change, every question looked equally weighty in the sidebar and on the card.
The only related signal was a small grey "durable" word in the card's top line. A
recommendation's quality showed only in its prose `why`, and the comparison with the other
options only appeared when clicking Explore deeper.

## Locked decisions

Ratings tables use the four axes. **Bold** marks the decision. Ratings are written as words so
they survive plain-text readers.

### 1. The importance level combines stakes with closeness (Q1)

**Decision:** the level measures how much your attention could change the outcome. It combines
stakes (how costly a wrong pick is) with closeness (how near the call is between the options).
The card's reason line says which of the two drove the level, e.g. "high stakes, close call"
or "high stakes, clear answer".

| Option | User experience | Technical correctness | Risk | Cost |
|---|---|---|---|---|
| A. Stakes only | mixed | mixed | good | good |
| **B. Stakes + closeness, with a reason line** | **good** | **good** | **mixed** | **good** |
| C. Agent confidence only | poor | poor | mixed | good |

- **A (stakes only) lost:** it would have you dwell on high-stakes questions whose answer is
  obvious.
- **C (confidence only) lost:** it would flag trivial coin flips as needing you.
- **Why B:** combining the two ranks questions by where your judgment matters. Closeness also
  shows in the ratings themselves: a close call is one where options trade wins across the axes.
- **What B gives up (its weakest axis is risk):** one level hides two reasons. Without the
  reason line, a low level on a hard-to-reverse decision would read as the agent shrugging it
  off. That is why the reason line is required.

### 2. Four levels, named by what to do (Q4)

**Decision:** the levels are **Skim · Check · Decide carefully · Your call**. Each comes with a
reason line on the card.

| Level | When it applies |
|---|---|
| Skim | Low stakes, whatever the closeness |
| Check | High stakes, clear answer: read the reasoning and confirm |
| Decide carefully | High stakes, close call: this is where your time goes |
| Your call | Pure preference the agent cannot judge (naming, wording, taste) |

| Option | User experience | Technical correctness | Risk | Cost |
|---|---|---|---|---|
| A. Skim · Check · Decide carefully | good | mixed | mixed | good |
| B. Low · Medium · High | mixed | mixed | mixed | good |
| C. Time budget (~30 s · ~2 min · 5+ min) | mixed | poor | mixed | good |
| **D. A plus Your call** | **mixed** | **good** | **good** | **good** |

- **B (Low / Medium / High) lost:** you have to translate it into an action, and "High" reads
  as alarm rather than "this one needs you".
- **C (time budget) lost:** it sounds precise but is a guess about your reading speed. It also
  frames attention as minutes to spend rather than care to take.
- **A (three levels only) lost:** taste questions break the model. Their closeness is total and
  their stakes are often low, so they would score Skim. Yet the agent's recommendation is worth
  least exactly there, and only your preference decides.
- **Why D:** calling these questions "Your call" stops you rubber-stamping the agent's taste.
- **What D gives up (its weakest axis is user experience):** there is one more level to learn.

### 3. `durable` stays, but only in the doc (Q7)

**Decision:** `durable` keeps its job exactly as is: it decides which questions go in Locked
decisions (with rejected options and why each lost) and which become one-line Routine choices.
It is **removed from the page**, which shows only the importance level.

| Option | User experience | Technical correctness | Risk | Cost |
|---|---|---|---|---|
| A. Keep both on the page, independent | poor | good | good | good |
| B. Replace durable with "high stakes" | good | poor | poor | good |
| **C. durable becomes doc-only** | **good** | **good** | **mixed** | **good** |

- **The two flags answer different questions:**
  - A high-stakes question with an obvious answer is Check for you, but still belongs in Locked
    decisions, so nobody reverses it later without the reasoning.
  - A Your-call question is low stakes, yet you spend real attention on it.
- **B (merge them) lost:** it would lose one of the two signals. It would also change old
  sessions' state files and the doc structure for no gain.
- **A (both on the page) lost:** it shows two overlapping badges whose difference you would
  have to remember.
- **What C gives up (its weakest axis is risk):** you can no longer see during the interview
  which decisions will be locked. The Finish doc is where that shows.

### 4. A consistency rule keeps the agent honest about its own recommendation (Q9)

**Decision:** two rules apply together:
- If the recommendation is best or tied on every axis, the question is **not** a close call,
  so it cannot be Decide carefully on closeness grounds.
- The `why` **must name the recommendation's weakest axis** and what it gives up there.

There is an escape: when an option genuinely dominates, the agent says so plainly ("best on
every axis; it costs nothing here") rather than inventing a weakness.

| Option | User experience | Technical correctness | Risk | Cost |
|---|---|---|---|---|
| A. No rule; trust the agent | poor | poor | mixed | good |
| **B. Consistency rule + name the weakest axis** | **good** | **good** | **mixed** | **good** |
| C. Process rule: rate first, then pick | mixed | mixed | mixed | good |

- **The failure being guarded against:** the agent rates its own pick good everywhere. Every
  recommendation then looks like a clear winner, the trade-offs flatten, and levels drift down
  to Skim or Check.
- **Why B:** it ties the parts together so one checks the other, and a reader can verify it on
  the card.
- **C (process rule) lost:** it is unverifiable, because the agent's order of work is invisible.
  An agent that favours its pick will rate to fit anyway.
- **A (no rule) lost:** the ratings tend toward decoration.
- **What B gives up (its weakest axis is risk):** without the stated escape, the agent might
  invent weaknesses. The prototype highlights the weakest-axis phrase in the why ("Its weakest
  axis is risk").

## Routine choices

### Ratings

- **Axes (Q2):** the default set is four axes:
  - **User experience:** how it feels to the person using it.
  - **Technical correctness:** whether it works as intended, fits the system, and is not a
    burden to live with. Maintainability is folded in; the user's note was "they're kind of
    close neighbors".
  - **Risk:** what can go wrong and how badly, including lock-in. Reversibility is folded in
    here rather than dropped, because lock-in is often the recommendation's only real cost.
    The why says whether a red risk chip means "could break" or "hard to undo".
  - **Cost:** the recurring bill each time it runs (money, tokens, latency). It is **not**
    build effort, which stays off because agent estimates overstate the robust option.

  Chip order is user experience, technical correctness, risk, cost.
- **Which options are rated (Q3):** every option is rated, compactly, on the card. A rating
  means little in isolation; the comparison is the point. Explore deeper keeps its role as the
  prose behind the marks.
- **Display (Q5):**
  - A row of chips under each option's text, with **full axis names** ("User experience",
    "Technical correctness", "Risk", "Cost").
  - Chip tint: light green = good, yellow = mixed, red = poor.
  - No legend, no key, no column headers.
  - The user turned down the colour-blind variant (a small ✓ / ~ / ✕ inside each chip); see
    Risks.
- **Axis set per grill (Q6):**
  - The default four apply unless they clearly do not fit the topic (e.g. a pricing grill or a
    promo video, where "technical correctness" means little).
  - In that case the agent replaces the set once, at the start of the grill. It is never
    changed per question.
  - An axis may be left blank ("does not apply") on a question where it does not apply.
  - Because chips carry full axis names, a replaced set needs no legend; the page just shows
    the grill's axis names.
- **Explanations on the chips (Q11):** none. The user's words: "I don't think we need the
  hover. It should just be at a glance, and if they want to dig deeper, they can. I don't want
  to pay that cost for every single question." The agent writes no per-mark reasons. A chip's
  native tooltip shows only the axis and rating ("Risk: poor"), with no extra agent output.
  Explore deeper is the explanation.

### Importance levels

- **Sidebar (Q8, Q20):**
  - Within each round, rows sort by level: Decide carefully and Your call first, then Check,
    then Skim last. Rounds stay in order, so dependencies never break. Ids within a round may
    read out of order.
  - The sidebar shows the level as a **word in small coloured text under the row's title**,
    and only on **Decide carefully** rows (red) and **Your call** rows (purple). Skim and Check
    rows carry no mark.
  - The earlier signal-strength bars were rejected ("looks too much like a cell phone
    signal"), as were a dot, icons, and words on every row.
- **Card:** a level pill above the title shows the level name plus the reason line, e.g.
  "DECIDE CAREFULLY · high stakes, close call", for every level. A header **Levels** popover
  lists the four levels and what each means.
- **Your-call cards (Q10):** the recommendation is relabelled **"My lean"** with its why, and
  the accept path still works. **No ratings** are shown, since the axes do not separate the
  options (flat ratings are noise).

### Doc, colours and dark mode

- **Finish doc (Q12):**
  - Each Locked decision gets a ratings table: options as rows, axes as columns, the decision
    marked, and ratings written as words (good / mixed / poor).
  - Routine choices stay one line each.
  - Importance levels are not written into the doc.

  This doc follows that format.
- **Dark mode (Q19):**
  - Every new colour is a `light-dark()` CSS variable beside the palette from pull request #8:
    level pills, Your-call purple, and chip tints.
  - The prototype's pairs are in its `:root` block: `--chip-g-*`, `--chip-x-*`, `--chip-p-*`
    (bg / ink / line), `--taste*`, `--careful*`, `--stage-line`.
- **Dark-mode highlight colour (visual feedback, after Q20):**
  - In dark mode, `--accent` is a neutral warm off-white `#d9d1c3`, with `--accent-soft`
    `#2c2720` and `--accent-line` `#4a4238`. This replaces #8's dark coral `#e0785c`.
  - The user's reasons: "Too much red takes away from importance of 'Decide carefully'". Blue
    was tried and rejected ("blue adds too many colors").
  - Decide carefully gets its own `--careful`, `--careful-soft` and `--careful-line` variables
    (dark `#e0785c` / `#38211b` / `#5a2e24`), so it never moves with the accent again.
  - Light mode is unchanged.
  - This edits #8's palette, so it ships in the importance-and-ratings build, not in #8.

### Merging and the next version

- **Merge order (Q13):** contributions first: **#31 → #8 → #26 → #25**, then build importance
  and ratings on top. The chips and "My lean" land in the markup #26 rewrites, and they need
  #8's colour variables. A local preview of exactly this merge already exists (see Verified
  facts).
- **Finishing #26 and #25 (Q14):** request the remaining changes on both PRs with the exact
  list. If the author has not updated within **one week**, we finish them ourselves, keeping
  their authorship.
- **Next version scope (Q15):** importance levels and rating chips, plus three defect fixes
  that can ship alongside or ahead of it:
  - **#33: `serve --detach` plus a listening heartbeat.** The server daemonises itself on
    every OS, and the page can tell you when no agent is listening and sends are queueing.
  - **#13 hardening**, with a test each:
    - reject requests whose Host is not `127.0.0.1` / `localhost` (and the LAN host when
      `--lan` is on);
    - serve `/visual` with a sandbox Content-Security-Policy header;
    - cap the `/send` body size.
  - **#32 follow-up:** text typed in a discussion box but not added is included in the Send,
    or warned about, instead of being dropped.
- **Auto-open the page (Q16):** SKILL.md's Start step passes `--open` (added by #25) **by
  default**. This applies in local mode only, never on Resume (the old tab reconnects on the
  same port), and never with `--lan`. This resolves #14.
- **Markdown (Q17):** inline markdown (#26) is enough, so close #9. Add one SKILL.md line
  telling the agent that block markdown (lists, tables, headings, code blocks) does not render
  and shows as raw text.
- **Closing replies (Q18):** three replies are drafted (below under Open threads), to be posted
  only on the user's go:
  - **#30:** close as a duplicate of #8, once #8 merges.
  - **#7:** close as not planned, pointing at the community projects.
  - **#32:** say it does not reproduce, ask for logs, and mention the un-added-text fix.

## Verified facts

These were established by exploring the repo and GitHub, not by asking. Everything was checked
on 2026-10-18.

### The page before this change

- `durable` showed only as a small grey word in the card's top line.
- Picking the recommended option counts as "accept".
- Explore deeper produces a pros/cons table per option.
- The left sidebar groups questions by round; each row shows the id, the title, and the status
  (open, answered, staged, sent).

### Local preview of the merges

The live checkout `~/Projects/grill-with-ui` is on the local branch **`preview/contrib-prs`**.
It is main (`c8f699d`) with #31 → #8 (head `5240431`) → #26 → #25 merged in that order; #25's
merge commit is `b1dd4c8`. Nothing has been pushed, merged, or posted on GitHub.

- **One conflict:** #25 and #8 conflicted in `server.mjs`, because both rewrote the request
  head. The resolution keeps both changes: #25's LAN token gate first (non-loopback requests
  need a valid `t` token, or get a 403), then #8's `__GRILL_THEME__` placeholder replacement
  on `GET /`.
- **Extra fix:** #8's `fetch("/theme", …)` in `page.html` is wrapped with #25's
  `withToken(…)`.
- **Tests on the merged result:** server 31/31, markdown + parity 8/8, page e2e 134/134. The
  page e2e run needs `PLAYWRIGHT_PKG` pointed at an installed `@playwright/test`.
- **Warning:** every new grill session runs from this branch until the checkout is switched
  back to main.

### Triage of every open pull request and issue

| Item | Finding | Plan |
|---|---|---|
| #31 Dependabot | Clean | Merge as-is |
| #8 dark theme | Clean; system / light / dark toggle, choice remembered. Its CI run is `action_required` (first-time contributor) and needs approval | Merge as-is |
| #26 inline markdown | See the list below the table | Request changes, then merge |
| #25 LAN mode + `--open` | See the list below the table | Request changes, then merge |
| #33 wait-mode deadlock | Real. SKILL.md's `nohup … &` detach line has no Windows form, so Windows harnesses deadlock | Next version: `serve --detach` + heartbeat |
| #32 discussion not sent | Does not reproduce on main. The real trap: un-added discussion text is dropped on Send (`buildActions`, page.html ~361–370) | Next version fix + closing reply |
| #13 security | Confirmed: no Host header check (server.mjs ~152–154), so DNS rebinding can read `/state`, `/events`, `/visual`; `/visual` has no sandbox CSP; `/send` has no body cap | Next version hardening |
| #30 dark mode | Duplicate of #8 | Close when #8 merges |
| #24 LAN URL | Closed by #25 (`Fixes #24`) | Closes itself |
| #14 auto-open | Partly covered by #25's opt-in `--open` | `--open` by default (Q16) |
| #9 markdown | Closed by #26 (`Fixes #9`) | Inline only + SKILL.md line (Q17) |
| #10 resizable discussion panel | Cheap, not urgent | Later |
| #11 grill-wide discussion | New action type, state field, and sidebar entry; collides with the sidebar re-sort | The version after |
| #7 wayfinder counterpart | Separate skill | Close as not planned |

**#26, remaining changes:**
- Code spans hard-code `#efebe3`, which is wrong in dark mode. Use `var(--hover)`.
- `isSafeUrl` lets `//evil.com` and `/visual` through. The second opens the agent's visual
  unsandboxed. Allow only `http(s):` links.
- Nits: use `links[n] ?? m`, and have the page-parity test use the page's own escape function.

**#25, remaining changes:**
- With a valid token, skip the Origin allowlist; sends from a `.local` hostname currently get
  a 403.
- Document `--open` as Start-only in SKILL.md.
- Resolve the conflict with #8, as done in the preview.
- Squash.

### Community wayfinder UIs (checked on GitHub for #7)

- `cachemoney/wayfinder-ui`: by the commenter on #7. Wayfinder decisions as an interactive
  dependency graph, clearly modelled on grill-with-ui. Last push 09-23, 0 stars.
- `intelligentrascal/skills`: browser-UI versions of grill-me, grill-with-docs and wayfinder.
  Last push 10-07, 0 stars.
- `hsyam/matt-skills-ui`: a web board over Pocock's skills' output. Last push 10-07, 5 stars.

There is no repo literally named "wayfinder-with-ui".

## Risks

- **Colour-blind readers:** chip ratings are carried by colour alone, and red/green is the most
  common confusion. The ✓ / ~ / ✕ variant was turned down. The sidebar level words are text,
  so they are unaffected. If this comes up, the fix is a small symbol inside each chip.
- **Agent rating drift:** the consistency rule is checked only by a reader looking at the card.
  An agent can still rate to flatter its pick. The "name the weakest axis" requirement is the
  visible check, and tests can at least assert a weakest-axis phrase is present when ratings
  exist.
- **Calibration:** "good / mixed / poor" is coarse on purpose. Two agents may rate the same
  option differently. The ratings are a reading aid, not a measurement.
- **Axis swapping:** the agent may replace the default axes when they would have served. The
  rule is "defaults unless they clearly do not fit".
- **Sort order:** sorting within a round puts ids out of order (Q9, Q7, Q8), a small oddity.
- **Output cost:** ratings add output on every round: 4 ratings × up to 4 options × up to 3
  questions, plus a level and reason per question. They are short codes, not prose. Per-mark
  reasons were dropped to keep this cost down.
- **Dark accent change:** this edits #8's dark palette after #8 merges. A contributor following
  up on #8 might reintroduce coral. Mention it in the PR.
- **The preview branch:** the live skill runs from `preview/contrib-prs` until switched back.
  A grill started meanwhile runs unmerged contributor code. It passed the tests, but has not
  been reviewed for the #26 / #25 remaining fixes, including the `isSafeUrl` hole.

## Deferred

No question was deferred. Items left out of the next version, and what would bring them back:

- **#10, resizable discussion panel:** would reopen if the panel width becomes a complaint once
  the chips make cards denser.
- **#11, grill-wide discussion:** the version after next; it collides with the sidebar re-sort.
- **Block markdown (#9):** would reopen if threads keep needing lists or tables.
- **Colour-blind symbol in chips:** see Risks.
- **Light-mode accent:** light mode still uses the terracotta accent `#9a3a26` for both the
  highlight and Decide carefully. The user raised the "too much red" point only for dark mode.
  Would reopen if light mode feels the same.

## Open threads

### Awaiting the user's go (nothing has been posted, merged, or closed)

1. Approve #8's CI run, then merge **#31** and **#8** on GitHub.
2. Request changes on **#26** and **#25** with the lists in Verified facts. If there is no
   update in a week, finish them ourselves.
3. Post the closing replies, drafted below.
4. After the real merges, switch `~/Projects/grill-with-ui` back to `main` and pull. The local
   branches `pr-31`, `pr-8`, `pr-26`, `pr-25` and `preview/contrib-prs` can then be deleted.
   An old stash, `stash@{0}` (wait-mode docs), is redundant; leave it or drop it deliberately.

### Drafted closing replies (unposted)

- **#30** (post when #8 merges): "Thanks for asking for this! Dark mode is landing in #8, which
  adds a system / light / dark toggle and remembers your choice. Closing this as a duplicate so
  the discussion stays in one place; feel free to comment there."
- **#7**: "Thanks for the idea, and for the thread. A wayfinder counterpart is a separate skill,
  so I'm going to keep grill-with-ui focused on grilling and close this as not planned. If you
  want one now, a few community projects already exist: cachemoney/wayfinder-ui,
  intelligentrascal/skills (wayfinder-ui), and hsyam/matt-skills-ui."
- **#32**: "Thanks for the report, and sorry for the slow reply. I couldn't reproduce this on
  main: text added to the discussion is written to events.jsonl and printed by serve. Two
  things would help: the last few lines of events.jsonl in your session folder, and
  agent.handled from state.json. One related trap I did find: text typed in the discussion box
  but not added is dropped when you press Send. The next version fixes that."

## Implementation references

The implemented state fields, patch constraints, and authoring rules live in
[SKILL.md](../SKILL.md#statejson), with validation in `server.mjs` (`validateState` and
`validateAxesChange`). See [README Use](../README.md#use) for the shipped page behavior,
including compatibility with older sessions. These replace the provisional build notes.

The prototype's weakest-axis phrase highlighting is not shipped: it would pattern-match
agent prose, and #26 changes the rendering of that prose. The block-markdown guidance and
Start-only `--open` instructions await #26 and #25 respectively. This importance-and-ratings
PR is held until those contributor PRs merge and it is rebased onto them.
