# Checked joint-picture provider preparation

This is an internal source-only preparation step, not an enabled feature,
provider receipt, SEND implementation or world-write permission. It does not
upgrade the existing text-only patch dispatcher or legacy image handler.

The reader accepts an internally supplied data directory, capsule identity,
exact independent SEND and selected model/effort/runtime advertisement. It
rebuilds the original task from the checked capsule, requires unchanged image
capability and advertised effort order, and reads only the already committed
task-owned canonical PNG transport. No caller image paths, URLs, prompt, schema,
account selection or authority flags are accepted. Missing, corrupt, linked,
partial or unknown data is preserved, never adopted or repaired.

The private packet binds the exact prompt, proposal schema, ordered pixel
hashes, original joint invocation, recipient, runtime, SEND and transport. A
second original-source/transport check and current expiry check precede return.
The recheck takes a content digest and rebuilds private paths from the same
original sources; a matching digest is data equality, not consent. No files
are created, reencoded or changed by either operation.

All model-sent, live-capability, new-call and world-authority fields remain
false. The selected advertisement is not independent evidence of live provider
support. This module is not on an HTTP route or the context worker dispatch
table yet. Future integration still requires a separately owned joint job,
consume-once write-ahead reservation, live selected capability checks at actual
turn start, persistent original-turn/pixel receipt binding, original-response
compilation, UI disclosure and separate current-world apply/undo/save acceptance.

Authored synthetic tests cover original bytes and identity, swapped recipient
or effort, advertisement changes, expiry during reads, cancellation, source
corruption, links, caller injection and unchanged legacy rejection. They make
no real model call and cannot certify visual quality or an installed release.
