# Pi command macros: feasibility research

**Investigated version:** `@earendil-works/pi-coding-agent` **0.84.4**. The installed CLI reports the same version. The official `v0.84.4` tag resolves to commit [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi-mono/tree/b79e4cc834970cca69daebffab7df1da7d1e52c4).

## Answer

**Yes, for extension commands.** A macro extension can register `/ee` and re-submit `/branch ...` with `pi.sendUserMessage(..., { expandPromptTemplates: true })`. Pi then finds and runs the registered `/branch` extension command.

This is supported for the installed `/branch`: it is an extension command registered by `~/.pi/agent/extensions/branch-merge.ts`, not a Pi built-in command.

This is **not** a generic way to invoke every slash command. Pi built-ins such as `/model` and `/settings` are interactive-mode commands. They are not command-dispatch targets for an extension. Prompt templates also remain one-pass text expansion, not recursive macros.

## What Pi does

1. `AgentSession.prompt()` dispatches a leading slash name to an extension command **before** `input`, skills, and prompt templates.
2. `pi.sendUserMessage()` defaults to no expansion, but `expandPromptTemplates: true` opts into this dispatch.
3. The dispatch looks up one extension command and awaits its handler. There is no public `executeCommand(name, args)` API and no handler registry exposed to other extensions.
4. A template expansion returns its content once. Pi sends the result onward; it does not dispatch a slash command produced by that expansion.

**Evidence**

- Official extension guide, version-pinned: [`pi.sendUserMessage`](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#pisendusermessagecontent-options), [`pi.getCommands`](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#pigetcommands), and [input processing order](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#input).
- Installed implementation: `.../dist/core/agent-session.js:821-858` (dispatch precedes expansion); `:954-977` (one command lookup and handler execution); `:1161-1188` (the opt-in flag); `:2013-2020` (extension API is fire-and-forget and reports rejected calls as extension errors).
- Installed implementation: `.../dist/core/prompt-templates.js:221-235` (single `expandPromptTemplate()` substitution).
- The guide states that `getCommands()` lists extensions, templates, and skills, while built-in interactive commands do not execute through `prompt`: `.../docs/extensions.md:1560-1591`.

## Viable approaches, ranked

### 1. Command router macro — recommended for `/ee` → `/branch`

Register `/ee` as an extension command. Validate its arguments and idle-state rules. Then call `pi.sendUserMessage()` with expansion enabled.

```ts
// Illustrative only. Not created or run.
pi.registerCommand("ee", {
  description: "Run the branch workflow",
  handler: (args, ctx) => {
    if (!ctx.isIdle()) {
      ctx.ui.notify("/ee requires an idle agent", "warning");
      return;
    }
    pi.sendUserMessage(`/branch ${args}`.trim(), {
      expandPromptTemplates: true,
    });
  },
});
```

This uses Pi's supported dispatch path, so it preserves the existing `/branch` command behavior. The local `/branch` command registers `handler: (args, ctx) => runBranch(args, ctx, ctx.fork.bind(ctx))` at `~/.pi/agent/extensions/branch-merge.ts:2328-2355`. Its same-pane operation calls the public command-context `fork()` API at `:2178-2241`.

**Limits**

- This only dispatches commands registered by extensions. It cannot invoke built-in interactive commands.
- `pi.sendUserMessage()` returns `void`; it cannot provide a result or catch command errors to the macro handler. Pi reports failures through its extension-error mechanism instead.
- Extension commands run immediately, even while the agent is streaming. The macro must itself reject or explicitly support that state. This matters because the current `/branch` permits streaming only for tmux targets (`branch-merge.ts:2190-2203`).
- Guard against direct or indirect macro cycles such as `/ee` dispatching `/ee`.

**Primary sources**

- Official v0.84.4 example uses this exact pattern to queue an extension command: [`reload-runtime.ts`](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/examples/extensions/reload-runtime.ts).
- Installed guide: `.../docs/extensions.md:1439-1469`; installed example: `.../examples/extensions/reload-runtime.ts:1-30`.

### 2. Shared, explicit workflow API — best when several extensions must compose

Refactor the owned `/branch` workflow so its core behavior is a shared module or a documented `pi.events` request/response protocol. Then `/branch`, `/ee`, and shortcuts call the same function or protocol.

This avoids the limitations of fire-and-forget command re-entry. It gives the macro structured success, cancellation, and error results. It also makes the dependency explicit instead of assuming that a slash name is registered.

Pi exposes `pi.events` for communication between extensions, but it does **not** define a standard command invocation protocol. Both extensions must agree on event names, request/result shapes, timeout, and cancellation behavior.

**Primary source:** [`pi.events` in the official v0.84.4 extension guide](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md) (local `.../docs/extensions.md`, `pi.events` section). The local `/branch` core is private to `branch-merge.ts`; other extensions cannot import an exported command handler today.

### 3. Implement the needed operation with public command-context APIs

For a fixed macro that needs a session action, write it directly with `ExtensionCommandContext` methods such as `fork()`, `newSession()`, `switchSession()`, or `navigateTree()`. These methods exist only inside command handlers because Pi warns that using them from event handlers can deadlock.

Use this when the macro is a distinct workflow, not when it must reproduce every detail of `/branch` (tmux panes, custom UI, validation, or future `/branch` fixes).

**Primary source:** [`ExtensionCommandContext`](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#extensioncommandcontext); local `.../docs/extensions.md:1109-1137` and the `fork()` section immediately below. The present `/branch` is evidence that its richer behavior includes private, extension-specific code beyond `ctx.fork()`.

### 4. Input transformation — only for a new text syntax

An `input` handler can transform raw user text before a template is expanded. It is not the right way to intercept another registered slash command because extension command lookup occurs first and skips `input` once it finds a handler.

Use this only for syntax that does not conflict with a registered command, for example `@macro ee ...`, and treat the output as a prompt transformation rather than a command executor.

**Primary source:** [official input event order](https://github.com/earendil-works/pi-mono/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#input); local `.../docs/extensions.md:909-953`.

## Recommendation

Start with **approach 1** for the proposed `/ee` → `/branch` macro. It is supported in Pi 0.84.4 and reuses the installed `/branch` behavior without copying it.

Use **approach 2** instead if the planned macro language needs multi-step workflows, reliable completion results, cross-extension calls, or commands that must survive a future `/branch` rename.

## Uncertainties and scope limits

- No extension was created, loaded, or executed. A runtime test was intentionally not performed because testing `/branch` can create or switch sessions and tmux panes.
- The planned macro syntax, argument model, and whether it must invoke built-in commands are still unknown. Those decisions determine whether approach 1 remains sufficient.
- Pi 0.84.4 has no public, generic direct command-handler API. This conclusion is from the public API surface and installed implementation; later Pi versions can differ.
