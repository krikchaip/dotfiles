# Oh My Pi themes for Pi

This local Pi package vendors Oh My Pi's complete built-in theme set: the `defaultThemes` registry plus its root `dark` and `light` themes. The source snapshot is pinned in [`upstream.json`](./upstream.json).

The package intentionally replaces Pi's built-in `dark` and `light` registrations with Oh My Pi's themes of the same names.

<!-- upstream-provenance:start -->
- Upstream repository: <https://github.com/can1357/oh-my-pi>
- Pinned theme index: <https://github.com/can1357/oh-my-pi/blob/45e12e5bb758198a920c6070e7e64cb33b21beac/packages/coding-agent/src/modes/theme/defaults/index.ts>
- Pinned root dark theme: <https://github.com/can1357/oh-my-pi/blob/45e12e5bb758198a920c6070e7e64cb33b21beac/packages/coding-agent/src/modes/theme/dark.json>
- Pinned root light theme: <https://github.com/can1357/oh-my-pi/blob/45e12e5bb758198a920c6070e7e64cb33b21beac/packages/coding-agent/src/modes/theme/light.json>
- Pinned upstream license: <https://github.com/can1357/oh-my-pi/blob/45e12e5bb758198a920c6070e7e64cb33b21beac/LICENSE>
- Target Pi theme schema: <https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json>
<!-- upstream-provenance:end -->

The sync step keeps shared palette values and theme tokens. It removes Oh My Pi-only fields and tokens. It converts Oh My Pi `$variable` and semantic-token aliases to Pi variable references. Pi does not accept Oh My Pi's 8-digit color form, so sync strips the last alpha byte (`#717cb425` becomes `#717cb4`) to preserve Oh My Pi's rendered RGB. It also adds explicit Pi values for `scrollbarThumb` and `thinkingMax` from `selectedBg` and `thinkingXhigh`.

## Maintain the snapshot

Run these commands from this directory:

```sh
bun run sync
bun run check
```

`sync` reads source configuration only from `upstream.json`. It fetches the exact upstream inventory, updates the pinned README links and license, and swaps the complete generated theme directory into place. `check` runs the offline structural check, the native Pi loader check, and the online upstream provenance check.

Run checks separately when needed:

```sh
bun run check:structural  # offline JSON and inventory validation
bun run check:native      # real installed Pi loader, tested versions only
bun run check:upstream    # online README and LICENSE provenance validation
```
