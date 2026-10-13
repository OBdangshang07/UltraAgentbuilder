# Complete-task admission diagnostics

A complete-task SEND must establish its original process owner and freeze its
inputs before any provider dispatch. Owner-query or identity-validation failure
still rejects admission; it never enables retries, ownership adoption or world
writes.

The Bridge now distinguishes owner directory checks, process-query failures,
self-executable verification, owner creation and owner read-back. Diagnostics
contain only fixed phases, allowlisted error codes and the bounded query helper's
sanitized facts. They omit raw exceptions, stderr, command lines, account data,
tokens and executable paths.

The production process facts are read from the exact local .NET process handle,
instead of the slow Win32_Process CIM provider. Machine identity and BOTH
independent boot observations remain unchanged. Developer scripts share this
implementation rather than retaining a slower duplicate. Native FILETIME is floored to
whole microseconds to preserve the legacy v1 CreationDate identity; this does
not enlarge the timestamp matching window. Independent real Windows tests must
match legacy CIM facts and still identify an original legacy owner as the same
process. Access-denied and race failures are rejected, not treated as absence.
The existing production bounded query allowance is unchanged; no repeated query
is added. The independent old-CIM test control has one fixture-only 60-second
allowance. It is labelled separately and never authorizes a provider call. A
synthetic v1 lock with actual CIM facts is distinguished from the private test
of an actual old issuer; neither is a recovered game-task owner.

If the original creator fails after creating a new job directory but before any
request member exists, it may append a create-once `admission-failure.json`.
This hashes the original task, preparation, runtime, reservation claim and
directory and records the attempting controller PID. It is an admission failure,
**not a verified process-owner reference**. Later paired reads return the same
fixed diagnostic; duplicate SENDs remain rejected without another model call.

If a request member already exists, even empty or partially written, the result
is ambiguous. It is retained and is never labelled an uncommitted request. A
failure to persist diagnostics also cannot erase the original rejection. Readers
do not backfill missing records, fix corrupt diagnostics or issue new ownership.

Synthetic fault tests cover rejected owner creation, bind failure, partial
request writes, diagnostic disk failure, defensive sanitization and original
POST/GET/duplicate-SEND behavior. These tests are not installed-game, native
graphics, real-provider quality, physical IME, Iris or release acceptance.
