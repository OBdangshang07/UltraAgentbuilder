# Consume-once joint SEND registration

This internal source milestone registers a prospective selection-and-picture
job. It is **not a model dispatcher, invocation receipt, HTTP feature, UI flow,
current-world baseline check or installed acceptance**. No provider, account
lookup, invocation journal or world writer is reachable from the registry.
Existing text-patch and reference-building workflows are unchanged.

`createReferenceWorldPatchJobRegistry` uses an internally supplied data directory
and that directory's original bounded context lane. New registration requires
the exact independent `FrozenReferenceWorldPatchExplicitSend`, unchanged
recipient/effort/image advertisement, original committed capsule and task-owned
canonical pixels. The capsule's runtime identity must equal the actual current
runtime; caller clock, paths, prompt, schema, accounts, replacement runtime or
authority flags are not accepted. Registration repeats source/pixel checks
before and after exact live-process owner capture and checks runtime identity
again before committing.

The job is stored separately in `reference-world-patch-design`. Its immutable
request binds the original SEND/receipt, prompt/input and preparation digests,
ordered pixel hashes, transport, invocation fingerprint, runtime and independently
captured original process reference. `request.json` is the last write-once commit.
It stores neither the exact prompt nor private image paths. A partial original
directory consumes that SEND but cannot be adopted or completed by a duplicate.

Concurrent same-instance duplicates await the original operation. Committed
duplicates and reopening return the same checked reservation history, without
creating a new owner. A separate on-disk exclusive publication claim serializes
quota checks and new publication across instances/processes. Only the precise,
successfully written claim of the original operation is removed. A stopped,
partial or changed claim is preserved, not reclaimed because of its age, PID or
an observation timeout. The current eight-record quota evicts nothing. This is
bounded development storage, not a model-output token limit; an installed
history/archive workflow remains unfinished.

The reservation says `send-consumed-not-dispatched`, with zero calls reserved.
It deliberately retains `modelSent=false`, `sendingImplemented=false`,
`liveProviderCapabilityVerified=false`, `serverBaselineVerified=false`,
`canAuthorizePlacement=false` and `allowsNewModelCall=false`. These are this
registry's scope, not a claim about a future dispatcher's outcome. Unknown extra
files, including a provider journal, cannot be reported as an unspent reservation.
GET does not re-read the entire source archive and reports that limitation.

`readOwnedInput` is private and only available to the same live registry instance
that committed the exact original owner reference. It rebuilds the original
packet through the bounded worker, verifies current expiry/runtime and all
original input/transport/pixel pins, and does not reserve or make a model call.
Reopening, persisted metadata, a duplicate SEND or a changed selected
advertisement cannot grant dispatch ownership. A returned packet is not a
provider receipt or evidence that any model saw an image.

## Remaining integration

The actual joint runner still needs a write-ahead call reservation before its
first provider action, a dedicated adapter path with live selected image/effort
checks at original turn start, original turn plus ordered-pixel receipts and
observation-only recovery. It must compile the original answer against the same
archived BEFORE/neighbor facts, retaining independent joint provenance. HTTP/UI,
player difference preview, fresh server baseline, explicit apply confirmation,
protected undo and same-asset saved-world acceptance follow separately. The
registry must not be used as an unversioned replacement for those gates or for
an existing active frozen task.

## Authored-data verification

Synthetic tests exercise exact registration and duplicate/reopen behavior,
different instances, all SEND pins, selected advertisement and runtime changes,
expiry, context discard, original corruption/links, cancellation, unknown
claims/state and bounded history without eviction. A separate real local child
process is held at the original request commit, confirmed live, then stopped;
the original partial request/claim is retained and cannot be adopted. This is a
synthetic publication fault test, not a model process or game crash test.

The quota test explicitly uses seven labelled synthetic metadata history entries
and a second genuinely frozen authored-data capsule. Such history metadata is
not source authentication, dispatch ownership or provider evidence. The runtime
change test changes a read only inside its test process; no source/runtime file
is edited. No real model call, world write or installed game is used.

The expanded eleven-file targeted regression passed 274 tests, with no failures
or skips; the 21 registry cases are a subset of that result, not an additional
count. Syntax checking covered 437 JavaScript files and the eleven
publication/branding checks passed. The initial fault fixture incorrectly let
its child exit while waiting at the commit checkpoint. Its IPC lifetime was
corrected, then the actual child was confirmed live before the intentional stop
and the negative adoption checks passed. The original failed local receipt is
retained privately. These targeted results do not replace complete CI,
installed game acceptance or a real provider/turn/picture test.

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-job-registry.test.mjs tests/bridge/reference-world-patch-provider-worker.test.mjs tests/bridge/reference-world-patch-provider-input.test.mjs tests/bridge/reference-world-patch-image-worker.test.mjs tests/bridge/world-context-store.test.mjs
```
