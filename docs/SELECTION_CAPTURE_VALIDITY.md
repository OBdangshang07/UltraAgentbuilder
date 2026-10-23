# Selection capture invalidation reasons

The server now uses one fixed reason classifier in both the READY tick check
and the checked-capture path. This is diagnostic only: it retains the previous
acceptance conditions, check order and short-circuit behavior. It neither
refreshes a snapshot nor reconstructs the cause of an already invalidated one.

| Fixed reason code | What was observed | What it does not establish |
| --- | --- | --- |
| `selection-watch-changed` | The original bounded watch revision differs from its captured revision. | Whether a block event or chunk event was the first historical cause, or whether the player caused it. |
| `selection-chunk-fence-changed` | The original loaded/unknown chunk coverage or chunk instance is no longer current. | That loading chunks again can restore the original identity or authorize a new baseline. |
| `selection-lifetime-invalid` | The original retention state is absent/invalid, or the original idle/pre-dispatch preparation allowance expired. | That an active dispatched generation exceeded a fixed duration. |

Only the first failing check is reported. A changed watch prevents the chunk
and clock reads; a changed chunk fence prevents the clock read. Exceptions in
a required observation still propagate to the existing failure handling. They
are not converted into a successful check or an absent process/world.

An explicitly dispatched original capture still has no artificial generation
duration. Idle captures, abandoned preparation, explicit revocation, world or
selection changes and actual environment/chunk changes retain their existing
limits. Re-reading creates a new snapshot; it does not revive or rebind the
previous task, replay a model call, refresh consent or grant placement rights.

The fixed messages include no raw exceptions, account data, paths or player
coordinates. The reason is an observation at rejection, not a full event log
and not proof of the earliest or sole system root cause. Earlier captures that
only retained the combined message cannot be retrospectively classified.

Eight focused Java tests cover all boolean combinations, exact lazy check
order, exception propagation, long original dispatch and rejected expired or
abandoned preparation. The complete local Java run contained 882 tests: 881
passed, one skipped, and no failures/errors. This successor also passed syntax and publication/
branding checks; it did not run another local full Node regression. Its own CI
and exact installed-game gates remain separate. No current in-flight game was
upgraded, and this diagnostic change does not establish a fix for its unknown
invalidation cause, unattended placement, architecture quality or release safety.
