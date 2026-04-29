---
name: submit-plan
description: Manual plan submission workflow using Plannotator CLI for browser-based feedback. Use when asked to "submit the plan", "I want to approve the plan first", or "start manual review"
---

# Submit Plan Skill

This skill provides the procedure for triggering a manual plan review using Plannotator infrastructure (CLI/Plugin).

## Goal

Open Plannotator's browser-based UI (Approve / Send Feedback) by piping plan content directly to the `plannotator` binary via stdin.

## Instructions

Reading this skill does NOT mean you should submit a plan. Only execute these steps when the user explicitly asks you to "submit the plan" or "send the plan to Plannotator".

1.  **Synthesize Plan**: Draft a detailed markdown plan based on the current conversation.
2.  **Execute Submission**: Use the `bash` tool to pipe JSON directly to `plannotator`.
3.  **Read result**: Parse the JSON returned on stdout:
    - `behavior: "allow"` → approved. Proceed with implementation.
    - `behavior: "deny"` → read `decision.message` for feedback. Revise plan and resubmit. Do NOT resubmit unchanged.

## Submission Command Format

Use a quoted heredoc (`<<'EOF'`) to prevent shell expansion. The `plan` content must be properly JSON-escaped (newlines as `\n`, double-quotes as `\"`).

```bash
plannotator <<'EOF'
{
  "tool_input": {
    "plan": "JSON_ESCAPED_MARKDOWN_CONTENT"
  }
}
EOF
```

## Constraints

- **Do not** attempt to submit a plan automatically after reading this skill.
- **Do not** execute steps in the Instructions section unless the user explicitly commands a submission.
- **Do not** attempt to process the plan result yourself; the Plannotator plugin/user will provide the feedback or approval once the browser session is closed.
