# Joint task-owned original images (local foundation)

This milestone freezes a **private local transport**, not a model dispatch,
public endpoint, installed UI feature or permission to edit a Minecraft world.
The existing text-patch and reference-building workflows remain unchanged.

`bridge/reference-world-patch-task-images.mjs` accepts a checked joint capsule
and its separate exact one-call SEND. It rereads the original capsule sources
and independent binding, then copies the canonical PNG bytes without resizing,
reencoding, substituting screenshots or altering image order. `send.json`
persists the validated original SEND, not a confirmation reconstructed from a
receipt or another caller. The commit-last manifest binds the original capsule,
prompt/schema invocation fingerprint, ordered pixel hashes, reference set,
snapshot, inner selection, advertised capability, runtime and one-call budget.

The store has at most eight committed records and 256 MiB of image/SEND payload.
Existing picture limits remain four images, 12 MiB per image and 24 MiB per set.
Every existing record's actual saved SEND and original source are independently
reread during quota accounting. Publication uses a store-wide exclusive claim,
so different capsules cannot race the quota scan. No record is automatically
evicted, and no unknown claim is taken over based on a PID or apparent age.
Only the current publisher's byte-verified own claim can be released.

Checked reads reject links, hardlinks, file/type/size changes, unknown inventory,
swapped image order, modified SEND, altered authority and inconsistent accounting.
Copy failures, cancellation or expiry retain incomplete records without adopting,
overwriting or resuming them. A process exit can leave an unknown claim; handling
that state needs separate explicit recovery, not an automatic resend. Repeated
freeze of a fully verified record is idempotent while the capture is current.

The private reader may audit the unchanged original transport after capture
expiry. It does not refresh consent, verify the current world baseline or permit
a new call. File paths returned by this internal reader must never be exposed
through public HTTP. A future dispatcher must recheck bytes and live provider
capabilities at its own authorized dispatch boundary.

All materialized records still report `modelSent=false`,
`sendingImplemented=false`, `liveProviderCapabilityVerified=false`,
`serverBaselineVerified=false`, `canAuthorizePlacement=false` and
`allowsNewModelCall=false`. No context-worker operation, provider invocation,
budget reservation, consume-once SEND registry, response artifact, preview or
world transaction is implemented by this module. These remain separate product
gates; copying images is not evidence that a model saw them.

Synthetic regression uses authored PNGs/block facts and fault injection only:

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-task-images.test.mjs tests/bridge/reference-world-patch-send-bindings.test.mjs tests/bridge/reference-world-patch-capsule.test.mjs
```

It checks original bytes and SEND, idempotence, source/task corruption, ordering,
authority and expiry, cancellation and interrupted publication, actual worker
termination at the commit barrier, changed claims, link/hardlink rejection,
cross-capsule saved-SEND auditing and concurrent quota
saturation. No real model calls or player-world writes are made. The synthetic
quota fixture's temporary source-archive detour is test setup only, never a
production retention or recovery policy.
