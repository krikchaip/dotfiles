#!/bin/sh
# The popup binds run this file: `exec ~/.config/herdr/toggle-popup/toggle.sh FLAGS...`.
# Herdr runs a popup bind with `/bin/sh -c` and the PATH of the Herdr server.
# On macOS that PATH finds /usr/bin/python3 (3.9) first, so use the Homebrew
# python3 when it exists: Homebrew points it at its newest Python. Without it,
# as on Linux, use python3 from a login shell. A shell bind runs in a login
# shell (`/bin/sh -lc`) too, so python3 and the popup programs come from the
# same PATH, for example ~/.local/bin from Debian's ~/.profile. The popup
# server and its programs get this PATH when this toggle starts the server.
# On a Python older than 3.11, python_guard.py runs toggle_popup.py again on a
# newer one. Without python3, a toast tells the user: the popup closes at once.
p=/opt/homebrew/bin/python3
case $0 in
    */*) dir=${0%/*} ;;
    *) dir=. ;;
esac
if [ -x "$p" ]; then
    exec "$p" "$dir/toggle_popup.py" "$@"
fi
exec /bin/sh -lc '
if ! command -v python3 >/dev/null 2>&1; then
    echo "toggle-popup: python3 not found" >&2
    "${HERDR_BIN_PATH:-herdr}" notification show "Toggle popup" \
        --body "python3 not found: toggle-popup needs Python 3.11+" >/dev/null 2>&1
    exit 127
fi
exec python3 "$0" "$@"' "$dir/toggle_popup.py" "$@"
