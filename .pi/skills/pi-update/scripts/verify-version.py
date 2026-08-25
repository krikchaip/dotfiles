#!/usr/bin/env python3
"""Fail unless Pi and mise both select the expected version."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

TOOL = "npm:@earendil-works/pi-coding-agent"


def output(*args: str) -> str:
    return subprocess.run(
        args,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    ).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("expected")
    args = parser.parse_args()

    try:
        pi_path = shutil.which("pi")
        pi_version = output("pi", "--version")
        mise_version = output("mise", "current", TOOL)

        failures = []
        if pi_version != args.expected:
            failures.append(f"pi --version: expected {args.expected}, got {pi_version}")
        if mise_version != args.expected:
            failures.append(
                f"mise current {TOOL}: expected {args.expected}, got {mise_version}"
            )
        if not pi_path or "/mise/installs/" not in str(Path(pi_path).resolve()):
            failures.append(f"pi is not resolved through mise: {pi_path!r}")

        if failures:
            for failure in failures:
                print(f"FAIL: {failure}", file=sys.stderr)
            return 1

        print(f"PASS: pi {pi_version}")
        print(f"path: {pi_path}")
        print(f"mise: {TOOL}@{mise_version}")
        return 0
    except subprocess.CalledProcessError as error:
        print(f"FAIL: command exited {error.returncode}: {' '.join(error.cmd)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
