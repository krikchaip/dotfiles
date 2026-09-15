# Use immutable filesystem messages

Chat rooms use per-Peer Outboxes under operating-system temporary storage, with one atomically published Markdown file per Peer message, instead of one mutable shared file or an append-only log. This preserves message history, prevents concurrent writers and partial reads, and supports reliable redelivery until Acknowledgment while keeping the transport human-readable and portable across harnesses.
