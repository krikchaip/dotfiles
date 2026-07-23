# Pi Agent Customizations

User-owned Pi coding agent extensions, packages, plugins, and related agent runtime configuration. This context exists to keep Pi behavior customizations separate from other dotfiles concerns.

## Language

**Pi agent customization**:
A user-owned behavior change for Pi coding agent, including extensions, packages, plugins, and runtime configuration.
_Avoid_: Dotfile tweak, random plugin, agent hack

**Extension**:
A TypeScript module loaded by Pi to change behavior through lifecycle events, commands, tools, UI hooks, or runtime patches.
_Avoid_: Plugin, script

**Package**:
A reusable Pi add-on distributed or installed through Pi's package mechanism, which may provide extensions or related assets.
_Avoid_: Dependency, plugin

**Session name**:
A short display label for a Pi session, shown in session selection instead of relying on the first prompt.
_Avoid_: Title, chat name

**Active session branch**:
The current path through a Pi session tree, from first relevant entry to the current leaf.
_Avoid_: Full session, chat history

**Turn-boundary compaction**:
Early context compaction requested after a completed assistant turn reaches the configured threshold and no user input is queued. A tool-bearing turn resumes automatically after compaction; queued user input runs first and receives another threshold check at its turn boundary; a final-answer turn stops after compaction.
_Avoid_: Per-tool compaction, idle compaction, built-in compaction

**Mergeable session entry**:
An active session branch node that Pi can include in a generated summary: a message, custom message, compaction, or branch summary.
_Avoid_: Label, marker, session name

**Merge watermark**:
Globally meaningful source entry identifiers recorded on a target merge summary to prevent later merges from re-summarizing already transferred work.
_Avoid_: Source-session-local marker, last merged timestamp, summary text matching

**Merge delta**:
Mergeable entries on a source active session branch whose identifiers are absent from both the target active session branch and its active-branch merge watermarks. A merge summary is also absent when every source identifier in its own merge watermark is already known to the target; when transferred, those identifiers propagate rather than the summary node ID. An empty merge delta produces no merge.
_Avoid_: Full source summary, content diff

**Automatic rename**:
A single session name generation attempt after processing settles for the initial workload in a new unnamed Pi session, an unnamed cloned or forked child session, or a child session that inherited its parent's non-empty session name. In a child session, the initial workload begins with its first child-only user message regardless of submission origin and includes any steering or follow-up prompts queued before the agent settles. A settled workload containing only the user prompt remains nameable. Eligibility survives process restart before that workload. Success, failure, cancellation, or invalid output consumes the attempt; later naming remains available through the rename command.
_Avoid_: First low-level turn only, retry after later prompts, periodic rename, background rename

**Inherited-name automatic rename**:
Automatic rename for a child session carrying a non-empty session name inherited from its parent. Inheritance is established by a copied session-name entry, so a later independent parent rename does not change eligibility. Any later child name entry cancels it because explicit user choice wins. A missing or unreadable parent does not qualify; an unnamed child follows ordinary automatic rename.
_Avoid_: Current-name equality check, overwriting user choice, rename-on-every-child, parent-history rename

**Child rename delta**:
User and assistant messages on a child active session branch whose entry identifiers are absent from every entry in its parent session. It alone determines automatic rename for both unnamed and inherited-name child sessions; copied labels, metadata, summaries, and tool results are excluded.
_Avoid_: Merge delta, message-count guess, whole child branch

**Session rename scope**:
All eligible messages on active session branch; excludes messages on abandoned or sibling branches.
_Avoid_: Entire session tree, chat history

**Recent rename window**:
A suffix of eligible user and assistant messages from active session branch. It alone determines session name; broader session work is irrelevant. When `recent` lacks `N`, window has 10 messages, or five recent exchanges.
_Avoid_: Exchange count, arbitrary history slice, whole-session topic

**Rename command**:
`/rename` and `/rename session` use session rename scope; `/rename recent [N]` uses recent rename window. Other arguments are invalid. Argument completion offers `recent` and `session`; after `recent`, it offers `2`, `4`, `6`, `10`, and `16`.
_Avoid_: Silent input fallback, unsupported rename modes

**Session ID completion**:
Dynamic command-argument autocomplete for target or source sessions in current directory only. It inserts full UUIDs, shows UUID first segment as row label, and shows session name as description; unnamed sessions show `[Untitled]`. Active session is excluded.
_Avoid_: Global session scans, static session list, ambiguous short UUID insertion, active-session self-reference

**Budgeted rename excerpt**:
Chronologically ordered suffix of selected rename scope that fits naming-model context budget. Older messages are omitted.
_Avoid_: Reversed conversation, arbitrary message selection

**Rename prompt dialogue**:
Selected messages presented oldest to newest with role labels and no positional indexes.
_Avoid_: Reversed conversation, exchange indexes

**Streaming pane branch**:
An independently opened session branch while source response remains active. It begins immediately before source active session branch's latest real user message and leaves source response intact.
_Avoid_: Cloning partial assistant output, resending current user message, aborting source response

**Extended new command**:
`/new` behavior augmented by documented child and pane-split arguments. Same-pane forms are unavailable during streaming; idle bare `/new` retains Pi's native new-session action.
_Avoid_: Replacement new command, streaming session replacement

**New child session**:
A blank session whose parent link points to an existing, valid session file active when it was created. It inherits no conversation context.
_Avoid_: Branch, clone, context copy, dangling parent link
