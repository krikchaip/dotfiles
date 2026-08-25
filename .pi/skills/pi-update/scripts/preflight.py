#!/usr/bin/env python3
"""Print deterministic Pi update facts without changing repository state."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

TOOL = "npm:@earendil-works/pi-coding-agent"
STABLE_VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def run(*args: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        args,
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.stdout.strip()


def version(value: str) -> tuple[int, int, int]:
    if not STABLE_VERSION.fullmatch(value):
        raise ValueError(f"expected stable version X.Y.Z, got {value!r}")
    return tuple(int(part) for part in value.split("."))  # type: ignore[return-value]


def git_paths(root: Path, pattern: str) -> list[str]:
    output = run(
        "git",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        pattern,
        cwd=root,
    )
    return sorted(line for line in output.splitlines() if line)


def package_data(root: Path, manifests: list[str]) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    extensions: list[dict[str, str]] = []
    scripts: list[dict[str, Any]] = []

    for relative in manifests:
        path = root / relative
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"cannot read {relative}: {error}") from error

        package_name = str(data.get("name", Path(relative).parent.name))
        pi_extensions = data.get("pi", {}).get("extensions", [])
        if isinstance(pi_extensions, list):
            for entry in pi_extensions:
                if isinstance(entry, str):
                    extensions.append(
                        {
                            "package": package_name,
                            "manifest": relative,
                            "entrypoint": str((Path(relative).parent / entry).as_posix()),
                        }
                    )

        package_scripts = data.get("scripts", {})
        if isinstance(package_scripts, dict) and package_scripts:
            scripts.append(
                {
                    "package": package_name,
                    "manifest": relative,
                    "scripts": package_scripts,
                }
            )

    return extensions, scripts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", help="stable target version, for example 0.84.3")
    args = parser.parse_args()

    try:
        target = version(args.target)
        skill_dir = Path(__file__).resolve().parent
        root = Path(run("git", "-C", str(skill_dir), "rev-parse", "--show-toplevel"))
        current_text = run("pi", "--version")
        current = version(current_text)
        if target <= current:
            raise ValueError(
                f"target {args.target} must be newer than current {current_text}"
            )

        pi_path = shutil.which("pi")
        if not pi_path or "/mise/installs/" not in str(Path(pi_path).resolve()):
            raise RuntimeError(f"pi is not resolved through mise: {pi_path!r}")

        mise_version = run("mise", "current", TOOL)
        if mise_version != current_text:
            raise RuntimeError(
                f"mise selects {mise_version}, but pi reports {current_text}"
            )

        extension_files = git_paths(root, "home/dot_pi/agent/extensions/*.ts")
        manifests = git_paths(root, "home/dot_pi/agent/packages/**/package.json")
        tests = [
            path
            for path in git_paths(root, "home/dot_pi/agent/packages/**/test/**")
            if (root / path).is_file()
        ]
        package_extensions, package_scripts = package_data(root, manifests)

        result = {
            "repository": str(root),
            "currentVersion": current_text,
            "targetVersion": args.target,
            "piPath": pi_path,
            "miseTool": TOOL,
            "miseVersion": mise_version,
            "miseConfigs": run("mise", "config", "ls").splitlines(),
            "gitStatus": run("git", "status", "--short", cwd=root).splitlines(),
            "extensionFiles": extension_files,
            "packageExtensions": package_extensions,
            "packageScripts": package_scripts,
            "discoveredTests": tests,
        }
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
