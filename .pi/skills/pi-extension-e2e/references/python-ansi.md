# Python ANSI assertions

Read this after the live tmux reproduction gate in [`../SKILL.md`](../SKILL.md) passes and the selected driver writes a raw ANSI log. This assertion layer works with Expect, Bash, JavaScript, tmux-native, and other drivers.

## Assertion example

Run the selected driver first. Keep assertions close to the user-visible behavior.

```bash
set -e
./test/e2e-driver
python3 - <<'PY'
from pathlib import Path

LOG = Path('/tmp/pi-extension.e2e.ansi')
s = LOG.read_text(errors='replace')


def window(anchor: str, before: int = 1200, after: int = 2800) -> str:
    idx = s.rfind(anchor)
    if idx < 0:
        raise SystemExit(f'anchor not found: {anchor}')
    return s[max(0, idx - before):idx + after]


def show(chunk: str) -> str:
    return chunk.replace('\x1b', '<ESC>')


def require(chunk: str, needle: str, label: str) -> None:
    if needle not in chunk:
        print(show(chunk))
        raise SystemExit(f'missing {label}: {needle!r}')


def forbid(chunk: str, needle: str, label: str) -> None:
    if needle in chunk:
        print(show(chunk))
        raise SystemExit(f'unwanted {label}: {needle!r}')

require(s, 'extension-owned marker', 'extension effect')
chunk = window('expected heading')
require(chunk, 'expected heading', 'target text')
require(chunk, '\x1b[38;2;138;190;183m─', 'accent border')
forbid(chunk, '\x1b[38;2;204;102;102m', 'error color')
print('PASS terminal E2E')
PY
```

Replace `./test/e2e-driver` with the actual test command. The driver and assertion process must both exit nonzero when required evidence is absent.

## Theme sequences

Common Pi dark-theme sequences:

- Accent: `\x1b[38;2;138;190;183m`
- Dim: `\x1b[38;2;102;102;102m`
- Muted: `\x1b[38;2;128;128;128m`
- Error: `\x1b[38;2;204;102;102m`

Assert exact RGB only when color is the behavior under test. Otherwise assert semantic text and structural ANSI so theme changes do not break unrelated tests.

## Failure slices

Print a readable slice whenever an assertion fails:

```bash
python3 - <<'PY'
from pathlib import Path
s = Path('/tmp/pi-extension.e2e.ansi').read_text(errors='replace')
idx = s.rfind('target text')
print(s[max(0, idx - 1000):idx + 2500].replace('\x1b', '<ESC>'))
PY
```

If a token can appear during startup, assert against a separate action log. For non-ASCII byte checks, encode the expected text explicitly, for example `"text".encode()`.
