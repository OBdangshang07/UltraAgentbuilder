# Packaged Windows owner observer

The Windows x64 companion now includes a small .NET Framework read-only
helper. Packaging compiles the reviewed C# source using the existing Windows
framework compiler; the player's game never compiles code. The helper only
reads machine identity, two independent boot observations, and the requested
process's native handle facts. It does not read accounts, start model calls,
create ownership, write worlds, or recover a job.

## Runtime selection and identity

The companion chooses one implementation before starting a query:

- A packaged companion must use its bundled helper.
- A prepared developer checkout must use its source-hash-specific helper.
- Only an unprepared source checkout can select the previous PowerShell path.

A missing member, partial cache, changed source, invalid manifest, hardlink,
redirected path or mismatched executable hash rejects the prepared runtime.
There is no repair or alternative query after a failed or unknown outcome.
The manifest binds the source, executable bytes and packaging compiler hash.
The runtime checks the selected files again after the original helper closes.
The compiler hash is provenance, not a code signature or a claim that a local
attacker cannot replace an entire trusted installation.

Both implementations retain the existing v1 machine hash, PID, executable-path
hash and creation timestamp. Native FILETIME is floored to whole microseconds
to match legacy CIM identity; the timestamp matching window is not widened.
The boot observations must agree. Access-denied and racing process failures
reject the query rather than asserting that the process is absent.

The existing 45-second hard bound, 30-second first-phase active bound and byte
quotas remain. Stage markers cannot renew the deadline, and late zero-exit
results still fail. The original helper must close before its result is used.
Neither failure nor success grants model retries, ownership adoption or world
placement permission. Helper children do not receive model/GitHub credential
environment variables.

## Packaging and Java extraction

The two new runtime members are exactly
`runtime/windows-owner-helper.exe` and `runtime/windows-owner-helper.json`.
The Java installer permits those exact names, not an arbitrary executable
directory. Existing bundle hashes still govern installation and reuse.

Launch-length checks account for the helper's longer filename as well as
Node. A verified short cache may be used when required; corrupt previous
members cannot be hidden by that cache. Legacy bundles without the new helper
retain their Node-only path calculation. Task data remains in the instance.

## Current evidence and remaining gates

The frozen successor passed full local Java and Node regression: 874 Java
tests with one skip and no failures/errors; 2,338 Node tests with two skips,
no failures and no cancellations. Ordinary and long-instance Java tests also
ran a read-only self-query through their exact extracted runtime. The complete
241-member bundle, source inventory and original JAR manifest were checked.
A separate 12-query, three-way concurrent read-only observation used the
manifest-bound generated bundle, not a Java-extracted or game-tested runtime.

The earlier 45-second PowerShell CI timeout remains a failure with unknown
system root cause. Local passing results do not prove cold-start reliability
on all hosts. The new source commit still requires its own CI and exact
installed-game, Iris, same-asset placement and saved-world gates. Existing
in-flight jobs keep their original runtime and source; they are not upgraded
or resent. These source checks do not certify architecture quality, native
graphics stability, all roadmap stages, or a distributable release.
