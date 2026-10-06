# Bounded local joint-image worker

The context store now exposes two **internal-only** operations:
`reference-patch-freeze-images` and `reference-patch-original-images`. Both
accept a capsule identity and at most 4096 bytes of the separate exact joint
SEND. They do not accept caller paths, image uploads, changed scope or a mode
that converts an audit into permission. They reuse the checked local original
PNG/SEND transport rather than attaching pictures to the legacy text-patch job.

Disk parsing, source verification, quota inspection and byte copying run in
the existing bounded worker lane (one active worker, two queued operations,
60-second operation deadline and 512 MiB worker old-generation limit). These
are engineering bounds, not measured performance promises for large worlds.
Cancellation or close terminates the original worker before another queued
writer starts. An interruption after publication began may retain a partial
record or unknown claim; this is preserved, not automatically retried or taken
over. The existing transport tests exercise actual worker termination at the
commit barrier. Repeating a complete verified freeze is local idempotent work,
not an additional model call.

Original-image audit never creates a transport. Both operations can reread a
committed immutable capsule without recreating a discarded live context store.
New freeze still checks capture expiry; after-expiry original-only auditing
never refreshes consent, verifies the current world or authorizes a new call.
Private audit results contain internal attachment paths and must not be routed
to public HTTP or exposed to other sessions.

No public endpoint, UI, provider call, live image-capability verification,
consume-once SEND registry, invocation reservation, joint response/preview or
world transaction is introduced. The materialized data retains false model-
dispatch and world-authority flags. Production text patches still do not send
reference pictures; these worker operations are a source foundation only.

Synthetic regression:

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-image-worker.test.mjs tests/bridge/reference-world-patch-task-images.test.mjs tests/bridge/reference-world-patch-send-bindings.test.mjs
```

The authored tests cover exact original PNG/SEND, duplicate local preparation,
discarded source-store handling, byte/type/UTF-8/identity/confirmation rejection,
active cancellation, closed lanes, bounded queue, corruption, partial/unknown
states, no public path disclosure and zero provider calls. They are not a real
multimodal generation, game transaction, performance or release certificate.
