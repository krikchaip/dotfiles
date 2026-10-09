# Persistent Kitty image previews

The owned plugin is `home/dot_config/yazi/plugins/kitty-popup.yazi/`.

## Paths

- Kitty without tmux: `main.lua` delegates to Yazi's built-in image previewer. No tmux process or socket is needed.
- An ordinary tmux pane: the same native fallback applies.
- The persistent tmux popup: `main.py run` starts normal Yazi on its original terminal. It owns image IDs and wraps Kitty packets for the two tmux layers. It does not relay input or replay a saved terminal screen.

The existing popup plugin still owns process persistence, windows, panes, and history. Its existing popup-open callback refreshes only a pane with `@yazi-kitty-socket`: it resends that owner's cached image and asks Yazi to rebuild at the current size. There is no global `client-attached` hook. Other popup opens do not start the Python refresh helper.

## Internal boundary

`main.lua` owns preview widgets. It delegates to the native image or video previewer unless the owned `yazi_pwd` popup has complete Kitty/tmux/helper context. It gets a generation from the main Lua state, prepares the image over a private socket, then commits its token after `ya.preview_widget` accepts the job. The socket belongs to one Yazi PID. A nested app that inherits the socket cannot use that app's preview state. An exited owner also gives native fallback, not a custom preview error.

Only the owned popup subscribes to Yazi's hover event. When selection leaves the committed image, the owner captures its inner tmux grid and erases cells that still contain the Kitty placeholder character inside the exact committed image area. Text cells that already replaced placeholders stay unchanged. The owner also deletes that image ID and removes it from reopen state.

Before creating an owner, `main.py run` checks that both input and output refer to the tmux pane's actual PTY. A different multiplexer can inherit all tmux variables, but its new PTY still fails this check.

`main.py` serializes graphics writes and cancels the previous decoder before starting another. Decoder output is bounded at 64 MiB; completion state retains at most one result. The socket directory is mode 0700 and its socket is mode 0600. It does not change Yazi's inherited umask.

`preview.py` validates packets and placeholder rows, splits payloads at base64 boundaries, and tracks one committed image. Deletes name only its owned IDs. It accepts the unpadded payloads and repeated transmit actions produced by real `kitten icat`. `--loop=0` still emits later animation frames and header-only animation controls. The parser checks their image ID and transfer policy, discards them, and forwards only the first frame. A generated red/blue GIF test verifies the transmitted pixels are red.

Physical cell dimensions come from the popup's original tmux client. Yazi's cell estimate inside the nested popup is not reliable. Animations show their first frame. The adapter covers `image/*` and `video/*`; PDF previewers are not changed.

For videos, the adapter uses [Yazi's built-in video preloader](https://github.com/sxyazi/yazi/blob/v26.9.1/yazi-plugin/preset/plugins/video.lua) to generate the cached thumbnail. Kitty renders that image instead of the native terminal image backend. Seek delegates to the built-in video previewer. The prepare request separates the selected file path from the thumbnail path, so hover cleanup and reattach track the video, not its cache file.

## Checks

Run the unit and native-encoder checks from the repo root in Nu:

```nu
with-env { PYTHONDONTWRITEBYTECODE: '1' } {
    python3 -m unittest discover -s home/dot_config/yazi/plugins/kitty-popup.yazi/test -p 'test_*.py' -v
}
```

`live_popup_e2e.py` creates its own Kitty window, outer/inner tmux servers, and temporary Yazi config/cache. It disables automatic restore/save before TPM starts and removes its own resources in `finally`. Pass the intended Kitty endpoint explicitly:

```nu
with-env { PYTHONDONTWRITEBYTECODE: '1' } {
    python3 home/dot_config/yazi/plugins/kitty-popup.yazi/test/live_popup_e2e.py --kitty-to $env.KITTY_LISTEN_ON --video --full
}
```

Add `--gif /path/to/image.gif` to reproduce a real GIF without storing it in the repo. `--baseline` uses the installed plugin and callback read-only for comparison. The baseline does not preview a supplied GIF; it keeps the same fixture directory for other lifecycle checks.

`prepare_e2e.py` and `e2e.py` also support an existing test-owned context with `id`, `window`, `images/`, and `yazi/`. Prepared plugin/config bytes must match the selected source. Preparation must run again after each source change.

The live path checks a generated `.mov` thumbnail, video seeking, video hide/reopen, and video-to-text cleanup with `--video`. The full gate checks three hide/reopen cycles, smaller/restored popup geometry, tiny/transparent/large images, rapid image changes ending on text, normal-exit cleanup, and native Kitty without tmux. It uses the managed launcher and popup-open callback, not a test-only callback. Test-owned tmux servers receive their test Kitty window ID, so the runner also works outside a Kitty shell.

## No-op boundary

`mux_noop_e2e.py` opens only new, test-owned Kitty windows and GNU Screen sessions. It copies the current Yazi configuration, checks a clean environment, then simulates inherited variables from an exited preview owner. It closes its own sessions and removes its temporary config and cache. Both the clean Screen case and inherited-owner case pass. This checks the plugin boundary, not native image pixel support in Screen. Pass the intended Kitty endpoint explicitly:

```nu
with-env { PYTHONDONTWRITEBYTECODE: '1' } {
    python3 home/dot_config/yazi/plugins/kitty-popup.yazi/test/mux_noop_e2e.py --kitty-to $env.KITTY_LISTEN_ON
}
```

## Text transition

The full live gate performs 31 rapid image changes before selecting text. It requires zero placeholder cells in Kitty and the inner tmux grid, zero owned image IDs, no current image path, and at least one scoped cleanup request. Unit tests cover wide cells before the preview, combining marks in placeholders, preservation of new text, image-ID deletion, and empty cleanup.

Terminal cells and captured protocol bytes are not a pixel screenshot. The user confirmed the original two-layer prototype's pixels. A final visual check must keep that distinction.
