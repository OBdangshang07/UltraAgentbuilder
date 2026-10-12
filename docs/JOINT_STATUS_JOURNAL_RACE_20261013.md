# Original live joint status — 2026-10-13

The legacy version-1 joint reference/selection runner used a strict file reader
to poll a mutable invocation journal. Its exact original controller can
atomically replace that journal while persisting a provider binding or response.
A reader that observes the old file metadata and then the new bytes rejects the
read. A deterministic synthetic test reproduced HTTP 409 at that boundary.

While the exact original in-memory controller is running, status now uses that
controller's already-durable journal snapshot. Immutable request metadata, the
ledger directory and the one-call inventory are still audited. This view can
report only unfinished running/checking progress: it cannot certify a response,
publish a candidate, observe/adopt an owner or authorize placement. It is not a
persisted cache, a disk-error fallback or a new provider invocation.

After that controller stops, the existing strict journal, budget, provider,
completion and candidate checks remain authoritative. The regression completes
one original synthetic generation, then corrupts its terminal journal and
requires HTTP 409 with the corruption retained and no second generation.
HTTP SEND assertions also retain their sanitized response body for diagnosis.

The default version-2 whole-assembly runner already uses bounded in-memory
progress views; this fix applies to the legacy version-1 path. The identified
race is proven, but does not establish the cause of a previously retained full
regression SEND rejection whose response body was not recorded. That original
failure remains failed evidence, not a passed test or an authorization to replay.

The unfiltered joint HTTP and design-runner files passed all 30 tests, with no
failures, cancellations or skips. These checks use synthetic provider output,
no actual model calls, no game
launches and no world writes. A focused pass is not a full regression, real
provider, installed-game, design-quality or certified-release acceptance.
