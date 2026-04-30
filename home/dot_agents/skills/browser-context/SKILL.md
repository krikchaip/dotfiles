---
name: browser-context
description: Supplementary skill for the agent-browser skill. Provides guidance on handling persistent browser contexts, configuration locations, and execution context for agent-browser tasks. Triggers include "open website.com using admin context", "open website.com with user1", "check madoo.com with admin" or "login with admin"
---

# Browser Context Skill

This skill provides instructions for managing and using persistent browser contexts with `agent-browser`. Use this skill when you need to maintain session state (cookies, logins) across browser automation tasks.

## Key Information

- **Context Location**: Browser contexts are stored in `.agents/browser/context/<name>/`.
- **Execution directory**: Always run `agent-browser` commands WITHIN the specific context directory to ensure the CLI picks up the correct configuration (e.g., `workdir=".agents/browser/context/default/"`).
- **Forbidden Flags**: DO NOT use `--profile`, `--session`, or `--session-name` flags. Context is managed via `workdir` and `agent-browser.json`.
- **Storage**: All downloads and screenshots must go into the `downloads` subdirectory.

## Directory Structure

Each context directory contains:

- `agent-browser.json`: CLI configuration file. Running commands in this folder allows `agent-browser` to auto-load these settings.
- `state/`: The actual Chrome profile data/userdata directory.
- `downloads/`: Directory for saved files, screenshots, and downloaded artifacts.

## Instructions

1. Identify the target context in `.agents/browser/context/`.
2. Ensure the `workdir` for any `agent-browser` bash commands is set to the specific context directory.
3. Always specify the `downloads` folder path for artifacts (screenshots/downloads).

## Examples

### Using the Admin Context

To run a command using the `admin` context:

- Target directory: `.agents/browser/context/admin/`
- Tool: `bash`
- `workdir`: `.agents/browser/context/admin/`
- Command: `agent-browser open "https://example.com/admin" && agent-browser screenshot downloads/screen.png`

### Downloading a file in User1 Context

- Target directory: `.agents/browser/context/user1/`
- Tool: `bash`
- `workdir`: `.agents/browser/context/user1/`
- Command: `agent-browser open "https://example.com/report" && agent-browser download "button#download" downloads/report.pdf`
