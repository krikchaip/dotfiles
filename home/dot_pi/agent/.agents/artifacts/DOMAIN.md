# Domain Glossary

## Active Leaf

The entry in a Pi session where the next appended entry attaches. When a session is opened from disk, Pi derives this from the final non-header JSONL entry.

## Active Leaf Marker

A custom entry written by the Branch Merge extension after successful tree navigation so the selected Active Leaf becomes durable across session reopen.

## Branch Session

A separate Pi session created from another session so work can continue independently from the original conversation.

## Managed Image

An image attachment owned by the image-attachments extension and addressable by a stable placeholder such as `[#image N]`. Managed Images are distinct from tool-result images and other unlabelled image blocks.

## Managed Image Reference

An exact `[#image N]` placeholder in the latest user prompt. Any occurrence counts as a request to include that Managed Image in the next provider request, including occurrences inside quoted text or code.

## Managed Image Omission

A provider-context-only omission of a Managed Image's bytes from the current provider request. The old user prompt keeps its existing Managed Image Reference, and the image block is removed without replacement.

## Current Request Group

The consecutive user messages for the provider request currently being answered. If the request is still in a tool-calling turn, the group is the latest user-message batch before the trailing assistant tool call and tool result messages; each referenced Managed Image is sent at most once, attached to the first message in the group that references it.

## Merge

A workflow that summarizes the Source Session and writes that summary into the Merge Target.

## Parent Session

An optional directed link from one Pi session to another existing session. The link represents navigation or context ancestry only; it does not imply ownership, lifecycle control, merge history, permissions, or deletion cascade.

## Merge Target

The Pi session that receives context from another session during a Merge.

## Merge Summary Entry

A branch summary entry appended to the Merge Target during a Merge. It carries Source Session context and is the entry that receives the Summary Label.

## Post-Merge Action

The user-selected action after a Merge succeeds: switch to the Merge Target, switch and remove the Source Session, remove the Source Session without jumping, or stay in the Source Session.

## Session ID

A user-addressable identifier for a Pi session. Merge commands use full UUID-shaped Session IDs copied from `/session`, not partial IDs or session file paths.

## Source Session

The current Pi session where `/merge` is invoked. Merge summarizes the Source Session's entire Active Leaf path because it may not be related to the Merge Target.

## Summary Label

A label attached to a Merge Summary Entry for fast session viewer skimming. It uses the Source Session name when present; otherwise it is generated from the Source Session context. If generation fails, it falls back to the first segment of the Source Session ID.
