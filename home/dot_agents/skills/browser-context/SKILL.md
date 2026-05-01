---
name: browser-context
description: Supplementary skill for the agent-browser skill. Provides guidance on handling persistent browser contexts, configuration locations, and execution context for agent-browser tasks. Triggers include "open website.com using admin context", "open website.com with user1", "check madoo.com with admin" or "login with admin"
---

# Browser Context Skill

This skill provides instructions for managing and using persistent browser contexts with `agent-browser`. Use this skill when you need to maintain session state (cookies, logins) across browser automation tasks.

## Key Information

- **Context Location**: Browser contexts are stored in `.agents/browser/context/<name>/`.
- **Execution directory**: Always run `agent-browser` commands WITHIN the specific context directory to ensure the CLI picks up the correct configuration (e.g., `workdir=".agents/browser/context/admin/"`).
- **Storage**: All downloads and screenshots must go into the `downloads` subdirectory.

## Directory Structure

Each context directory contains:

- `agent-browser.json`: CLI configuration file. Running commands in this folder allows `agent-browser` to auto-load these settings.
- `state/`: The actual Chrome profile data/userdata directory.
- `downloads/`: Directory for saved files, screenshots, and downloaded artifacts.

## Instructions

### Creating a New Context

When asked to create a new browser context (e.g., "create a context named 'support'"):

1. Create the directory: `.agents/browser/context/<name>/`.
2. Create subdirectories: `state/` and `downloads/`.
3. Create `agent-browser.json` with the following template:
   ```json
   {
     "$schema": "https://agent-browser.dev/schema.json",
     "session": "<name>",
     "profile": "./state",
     "downloadPath": "./downloads",
     "screenshotDir": "./downloads"
   }
   ```
4. Once the context is created, start using it immediately by following the "Using an Existing Context" steps below.

### Using an Existing Context

1. Identify the target context in `.agents/browser/context/`.
2. Ensure the `workdir` for any `agent-browser` bash commands is set to the specific context directory.
3. Always specify the `downloads` folder path for artifacts (screenshots/downloads).

### Using Global Context

Global context means running `agent-browser` commands normally at the workspace root, entirely independent of the isolated `.agents/browser/context/` folders. State and downloads will default to the project root or system defaults.

1. Ensure the `workdir` is the workspace root (or leave it unset).
2. Do not use any of the `.agents/browser/context/` directories.

## Examples

### Creating the Support Context

- Target Directory: `.agents/browser/context/support/`
- Tool: `bash`
- `workdir`: `<workspace_root>`
- Command: `mkdir -p .agents/browser/context/support/{state,downloads} && echo '<json_config_template>' > .agents/browser/context/support/agent-browser.json`

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

### Using Global Context

To run a command in the global context:

- Target directory: `<workspace_root>`
- Tool: `bash`
- `workdir`: `<workspace_root>` (or unset)
- Command: `agent-browser open "https://example.com/public-page" && agent-browser screenshot ~/Downloads/agent-browser/screen.png`
