# Generation storage preflight

New Codex generation checks a fixed 1 GiB available-space safety reserve on the
original persistent-session volume and on the job's answer-evidence volume.
Immediately before the sole chargeable `turn/start`, it rechecks those volumes
and the original app-server's SQLite-state volume. The startup environment is
captured for that exact process; a job's project config cannot redirect this
check to another account or state store.

The startup `config/read` is read-only. Its effective `sqlite_home` takes
precedence over the original `CODEX_SQLITE_HOME`; otherwise state defaults to
`CODEX_HOME`, whose default is the user's `.codex` directory. Unresolved relative
effective configuration is refused instead of guessing its configuration-layer
base. Relative environment locations use the original process working directory.
Directory aliases are checked on their canonical target volume.

Sources: [OpenAI environment-variable documentation](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations)
and [config and state locations](https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations).
The 1 GiB reserve is this project's safety policy, not an OpenAI requirement.

Insufficient or unobservable space is a known pre-submit refusal with a
sanitized message. It creates no paid turn, fallback account, account migration,
cleanup or automatic retry. A setup-time refusal may retain an original empty
thread and its durable binding. Existing call reservations are not refunded;
legacy player status remains conservative rather than acquiring a new success
or no-charge certificate from an unversioned UI field.

This is not an output-token limit, an actual disk reservation or a completion
guarantee. Other programs may consume space after the check. An already submitted
turn is not watched, interrupted, adopted or repeated by this preflight. Reading
the same original persisted receipt remains separate and does not require the
new-generation gate. It still needs enough space to preserve its own evidence.

Synthetic regression cases cover each volume, aliases, SQLite precedence,
unknown/malformed quota, pre-connection refusal, setup-time refusal, unchanged
reservation/error history, original receipt recovery and no post-dispatch
watchdog. Existing transport fixtures use explicit synthetic quota snapshots;
they do not inspect real accounts. No authenticated generation or player-world
operation is part of these tests. Source publication does not certify a binary,
installed-game acceptance, architectural quality or the complete roadmap.
