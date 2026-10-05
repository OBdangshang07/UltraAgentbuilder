# Reference/world patch: original stored-source preparation

This is an internal source milestone, not an installed feature or release gate.
It builds on the [joint data contract](reference-world-patch-preparation.md).
The existing `WorldContextStore` bounded worker lane now accepts internal
`reference-patch-task-disclosure` and `reference-patch-review-task` operations.
Neither operation has an HTTP route. Neither invokes a model, reserves a call,
creates a consent token or modifies a Minecraft world.

## Verified inputs, not caller substitutes

The operations take an existing context ID, a new joint intent containing the
selected reference owner/set IDs, a model capability advertisement and a runtime
hash. Callers cannot supply picture paths, URLs, raw pixels, replacement world
snapshots, prepared prompts or an alternate clock.

`reference-world-patch-source.mjs` reopens fixed original context ownership,
payload, record, snapshot and summary files. It checks their identities, hashes,
coverage, source authority, lifetime and exact rebuilt snapshot. It reads the
selected original canonical reference manifest and pixels, which the joint
contract redecodes and checks again. Directory junctions/symlinks, file hardlinks,
unexpected files, changed files and per-file/set byte quotas are checked.
The existing archive-owner guard is retained; manually recreating an archived
draft directory cannot restore generation or review authority.
The configured private data directory is internal configuration, not API input.

The source helper's return value is **private and worker-only**. It must never
become an HTTP response. The public-shaped disclosure/review contains no local
paths or duplicate encoded pixels. As with the existing text-patch disclosure,
it intentionally includes the precise bounded block facts and selected reference
annotations that a future confirmed model request would transmit.

## Consent and lifetime boundaries

`reference-world-patch-task-disclosure.mjs` binds the exact original context
record, payload, expiration and saved capture ID to the joint task. Changing
the task, recipient, runtime, advertised capabilities or selected pictures
invalidates old review. Identical block facts under a different capture ID
require a new saved-context confirmation. Legacy text/reference confirmations
are not transferable in either direction.

Preparation/review checks expiration before and after work. It does not refresh
or delete expired records, create missing context stores, consume consent or
publish a durable capsule. Repeated preparation/review is read-only and
deterministic for unchanged live sources. The one-call data contract adds no
hidden picture-analysis call and no model output-token cap.

Capabilities remain **bound advertisements**, not independently proved current
provider receipts. Stored client block facts are not server signatures. Every
object retains `modelSent=false`, `sendingImplemented=false`,
`serverBaselineVerified=false` and `canAuthorizePlacement=false`.

## Remaining product work

Actual integration must recheck live discovered capability and source lifetime,
freeze/version the joint original-data capsule, persist exact invocation and
unknown-outcome records, and provide consume-once explicit SEND. No existing
legacy capsule may silently acquire pictures or a larger budget. The UI needs
combined image/context disclosure. Installed acceptance must prove actual
exact-picture transport and a closed real joint task, then the same original
patch's difference preview, fresh server BEFORE checks, separate placement
confirmation, protected undo and saved-world audit.

Synthetic tests in `tests/bridge/reference-world-patch-preparation.test.mjs`
use authored pixels and block facts. They are not provider image-receipt,
game-frame performance, installed UI or architectural-quality evidence.
