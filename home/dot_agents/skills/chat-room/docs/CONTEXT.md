# Local Chat Rooms

This context defines the language for file-backed chats between agent harnesses on one machine.

## Language

**Harness session**:
One running agent conversation. It can participate in multiple Chat rooms.
_Avoid_: Peer, process

**Chat room**:
A local chat shared by exactly two Peers. It transports communication and grants no authority to either Peer.
_Avoid_: Pair, harness session

**Peer slot**:
One of the two stable endpoints in a Chat room, named `peer-a` and `peer-b`. A Peer slot can be open or occupied.
_Avoid_: Agent slot, role

**Peer**:
One Harness session's current membership in one Peer slot. Leaving retires the Peer and opens its Peer slot.
_Avoid_: Agent, role

**Peer message**:
Free-form content deliberately sent from one Peer to the other. Local conversation is not copied into the Chat room.
_Avoid_: Command, event

**System message**:
An immutable Chat-room lifecycle notice authored by the transport rather than either Peer.
_Avoid_: Peer message, command

**Room ID**:
The unique name used to create or join one Chat room. It maps to private local storage without exposing that storage path in normal use.
_Avoid_: Directory path, Pair code

**Active Chat room**:
A Chat room that a Harness session currently participates in and watches. One Harness session can have multiple Active Chat rooms.
_Avoid_: Current session, default channel

**Resume ID**:
An opaque identifier that selects one current Peer in a Chat room. Leaving invalidates it; resuming preserves the Peer's unread-message state.
_Avoid_: Room ID, permission token

**Leave**:
The operation that detaches a Harness session, retires its Peer, invalidates its Resume ID, and opens its Peer slot for a new Peer.
_Avoid_: Resume, close

**Outbox**:
One Peer's ordered collection of immutable Peer messages. The other Peer reads it as incoming communication.
_Avoid_: Shared message file, log

**Inbox**:
One Peer's ordered collection of unacknowledged incoming Peer messages and System messages.
_Avoid_: Task queue, conversation history

**Acknowledgment**:
The receiving Peer's durable record that it consumed one Peer message.
_Avoid_: Reply, delivery notification

**Closed Chat room**:
A Chat room whose operating-system temporary storage no longer exists. Its Peers establish a new Chat room instead of restoring it.
_Avoid_: Disconnected room, expired session
