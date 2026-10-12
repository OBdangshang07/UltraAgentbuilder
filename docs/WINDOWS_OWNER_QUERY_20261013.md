# Windows owner observation — 2026-10-13

The owner observer now requests only the Windows identity properties it uses:
`LastBootUpTime`, and the queried process's `ProcessId`, `CreationDate` and
`ExecutablePath`. It no longer asks CIM to materialize every OS/process field.
Both boot observations and their equality check remain. The 30-second helper
bound, byte quotas, exact PID/creation/executable checks and rejection of late,
partial or failed observations are unchanged. No model retry, ownership recovery
or world-write authority is added.

The focused suite passed 24 tests, including both real Windows self-identity
queries (about 11.7 seconds each on the test host). These read-only queries are
not proof of unattended building generation, design quality or game acceptance.
The prior installed candidate and its original test evidence remain unchanged.

Remaining work includes preserving the original SEND diagnostic in the client,
the complete new-candidate regression, isolated installed-game verification,
and genuine model-to-same-asset-to-saved-world acceptance. This source milestone
does not certify a new binary release or permit replay of an uncertain task.
