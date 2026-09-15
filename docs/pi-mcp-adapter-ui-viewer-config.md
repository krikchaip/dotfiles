# pi-mcp-adapter MCP UI viewer configuration

## Result

There is **no replacement file setting** for `MCP_UI_VIEWER` in the current upstream source. The supported control is still the `MCP_UI_VIEWER` environment variable. It accepts:

- `none`, `off`, or `disabled`: do not open a browser or Glimpse window.
- `browser`: force the browser.
- `glimpse`: require the native Glimpse viewer.
- unset: use the default selection logic.

`MCP_UI_VIEWER=none` is the correct setting for inline-only MCP App results. The adapter still starts the local UI session and returns the tool result. It only suppresses the external window.

## Evidence

1. The UI-session code reads `process.env.MCP_UI_VIEWER` directly. The three suppression values set `viewer` to `"suppressed"` and `windowOpen` to `false`. [ui-session.ts lines 474-504](https://github.com/nicobailon/pi-mcp-adapter/blob/32b67f916745b31a30a80371a86f00f70ba0a561/ui-session.ts#L474-L504)
2. The public README documents the same environment variable and values. [README.md lines 737-745](https://github.com/nicobailon/pi-mcp-adapter/blob/32b67f916745b31a30a80371a86f00f70ba0a561/README.md#L737-L745)
3. Dedicated tests verify `none`, `off`, and `disabled`; they verify that neither browser nor Glimpse opens, while the inline tool output remains available. [ui-viewer-none.test.ts lines 162-220](https://github.com/nicobailon/pi-mcp-adapter/blob/32b67f916745b31a30a80371a86f00f70ba0a561/__tests__/ui-viewer-none.test.ts#L162-L220)

## `mcp.json` support

No `mcp.json` field controls the UI viewer. The upstream `ServerEntry` schema has no viewer or UI-window option. [types.ts lines 426-510](https://github.com/nicobailon/pi-mcp-adapter/blob/32b67f916745b31a30a80371a86f00f70ba0a561/types.ts#L426-L510) The global `McpSettings` schema also has no such option. [types.ts lines 577-650](https://github.com/nicobailon/pi-mcp-adapter/blob/32b67f916745b31a30a80371a86f00f70ba0a561/types.ts#L577-L650)

## Installed version comparison

The installed adapter is version `2.33.0`. The upstream checkout examined is also `2.33.0` at commit `32b67f916745b31a30a80371a86f00f70ba0a561`. Both use the same `MCP_UI_VIEWER` implementation and documentation. No installed-versus-upstream difference was found.

## Source verification

All cited GitHub links returned HTTP 200 during this check.
