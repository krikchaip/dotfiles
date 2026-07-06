---
description: "General-purpose agent for general, multi-step work: researching questions, locating and reading relevant code, implementing changes to files, and verifying results. Choose this one as the go-to when no more specialized subagent fits and delegating adds real value over doing it yourself."
display_name: General
tools: all
extensions: [pi-mcp-adapter, pi-web-access, pi-permission-system]
model: inherit
max_turns: 50
prompt_mode: append
run_in_background: true
---
