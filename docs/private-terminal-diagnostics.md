# Original full-task terminal diagnostics

The live full-task runner now attempts to retain a bounded private failure
record in the **same original job directory**. It binds the original request,
preparation, runtime and call count, records the current local phase, and keeps
the original exception's own message/stack/cause fields. Getters, custom
serialization and arbitrary response fields are not evaluated. Truncation,
cycles and unavailable fields remain explicit rather than invented.

The record is exclusively created and flushed. An existing, partial or failed
write is preserved; diagnostic failure cannot replace the task's actual error,
adopt another owner, or cause a model resend. No directory is invented if the
original reservation never issued its packet. Successful tasks do not create
this failure record. No raw diagnostic or private path is added to HTTP status.

This is internal diagnostic evidence, **not** a provider closure receipt,
retry authorization, candidate, game-write permission or proof of durability.
The original failed tasks are not reopened, backfilled or rewritten. Records
may contain private paths and error prose, must remain out of public Git and
release bundles, and have no public download endpoint.

This does not complete grouped application, protected undo, installed-game
acceptance, Iris visibility, physical persistence or the broader roadmap.
