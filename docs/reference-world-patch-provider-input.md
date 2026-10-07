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
support. Private context-worker preparation is wired as described below;
there is still no HTTP route or provider dispatch. Future integration requires
a separately owned joint job (the internal consume-once SEND registry is now
documented in [reference-world-patch-job-registry.md](reference-world-patch-job-registry.md)),
write-ahead call reservation, live selected capability checks at actual
turn start, persistent original-turn/pixel receipt binding, original-response
compilation, UI disclosure and separate current-world apply/undo/save acceptance.

Authored synthetic tests cover original bytes and identity, swapped recipient
or effort, advertisement changes, expiry during reads, cancellation, source
corruption, links, caller injection and unchanged legacy rejection. They make
no real model call and cannot certify visual quality or an installed release.

## Bounded internal worker preparation

The source-only context worker now has private
`reference-patch-provider-input` and `reference-patch-provider-recheck`
operations. They rebuild the same checked packet on the existing single worker
lane rather than reading and decoding pictures on the main event loop. The
operations accept only the capsule identity and a bounded JSON payload containing
the independent SEND, selected advertisement, and, for recheck, the original
preparation digest. They accept no caller prompt, schema, file paths, alternate
clock, account override or authority fields.

The original lane's two-entry waiting queue, 60-second operation limit and
512 MiB worker heap bound remain unchanged; the new input envelope is limited
to 4 KiB. This bounds only the binding envelope, not model output tokens or the
already stored environment/picture data. An already committed capsule and exact
image transport are required.
Reading after context discard does not recreate the context store, and expiry,
corruption, links, cancellation or missing transport do not authorize replacement
data, a new model call or an invocation reservation. Packet immutability is
restored after worker structured-cloning.

Fourteen authored-data tests cover actual local worker entry and return,
original-source equality, selected-advertisement changes, digest and input
bounds, worker-local expiry, cancellation/close, queue saturation, original
corruption and links. HTTP actions still return not-found, and the legacy Codex
image handler still rejects the joint descriptor. The test clock belongs only
to a labelled synthetic worker, not a configurable production operation.

The expanded eight-file targeted regression completed with 231 tests passed,
zero failures and zero skips. JavaScript syntax checks covered 434 files, and
all eleven publication/branding tests passed. The fourteen new tests are part of
that targeted result, not an additional count. These local targeted checks do
not stand in for this source change's complete CI, installed candidate or real
multimodal/game acceptance.

This worker step is not a joint model SEND implementation. It leaves model-sent,
live-provider verification, new-call and world-write authority false. Actual
integration still requires the new job registry to be wired to the separately
verified invocation reservation and original-turn receipt path described above,
followed by UI and installed game acceptance.

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-provider-worker.test.mjs tests/bridge/reference-world-patch-provider-input.test.mjs tests/bridge/reference-world-patch-image-worker.test.mjs tests/bridge/world-context-store.test.mjs
```
