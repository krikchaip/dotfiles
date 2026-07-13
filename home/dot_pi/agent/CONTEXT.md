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
A one-time session name generation attempt tied to the first user prompt in a new unnamed Pi session. Uses session rename scope.
_Avoid_: Periodic rename, background rename

**Session rename scope**:
All eligible messages on active session branch; excludes messages on abandoned or sibling branches.
_Avoid_: Entire session tree, chat history

**Recent rename window**:
A suffix of eligible user and assistant messages from active session branch. It alone determines session name; broader session work is irrelevant. When `recent` lacks `N`, window has 10 messages, or five recent exchanges.
_Avoid_: Exchange count, arbitrary history slice, whole-session topic

**Rename command**:
`/rename` and `/rename session` use session rename scope; `/rename recent [N]` uses recent rename window. Other arguments are invalid. Argument completion offers `recent` and `session`.
_Avoid_: Silent input fallback, unsupported rename modes

**Budgeted rename excerpt**:
Chronologically ordered suffix of selected rename scope that fits naming-model context budget. Older messages are omitted.
_Avoid_: Reversed conversation, arbitrary message selection

**Rename prompt dialogue**:
Selected messages presented oldest to newest with role labels and no positional indexes.
_Avoid_: Reversed conversation, exchange indexes

**Streaming pane branch**:
An independently opened session branch while source response remains active. It begins immediately before source active session branch's latest real user message and leaves source response intact.
_Avoid_: Cloning partial assistant output, resending current user message, aborting source response
