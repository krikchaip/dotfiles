# Domain Glossary

## Active Leaf

The entry in a Pi session where the next appended entry attaches.

## Branch Session

A separate Pi session created from another session so work can continue independently from the original conversation.

## Merge

A workflow that summarizes the current Branch Session, writes that summary into the Merge Target, and switches to the Merge Target.

## Merge Target

The Pi session that receives context from another session during a Merge.

## Session ID

A user-addressable identifier for a Pi session. Merge commands use full UUID-shaped Session IDs copied from `/session`, not partial IDs or session file paths.
