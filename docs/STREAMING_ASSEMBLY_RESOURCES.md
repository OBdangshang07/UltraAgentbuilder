# Bounded whole-asset streaming resources

Production joint assembly saves provisional parts in original order and writes
complete candidate metadata last. A bounded verification pass checks the full
original ledger, references, reviewed native geometry and evidence before
publication; saved members are rebuilt and compared again before returning a
result. Metadata and single-part reads still verify **every** original member.
Reading one part is not permission to place one part.

The normal runner and result workers retain only one current patch/preview,
plus a requested part when needed. The legacy data-only API still provides full
arrays for compatibility. Both paths preserve original v2 candidate identity,
exact BEFORE facts, native cells, scope, proofs and whole-set hashes. Failed or
cancelled publication retains its original claim and provisional files; no
timeout, retry or new process can adopt or clean them up as a completed result.

`contracts/world-assembly-limits.json` is consumed by both Java and Bridge.
It is fixed bundled policy, not a model token setting or user override:

| Resource | Bound |
| --- | --- |
| Whole patch bytes | 192 MiB |
| Complete candidate members | 224 MiB |
| Client download, including protocol envelopes | 256 MiB |
| Proposal / preview working bytes | 64 MiB each |
| Single patch / preview file | 16 MiB each |
| Single part transport envelope | 40 MiB |
| Candidate metadata / original records | 2 MiB each |
| Operations per part | 8,192 |

The part-count ceiling remains derived from edit capacity (128), with file
counts derived from the complete set rather than the old 32-part ceiling.
The pinned member list contains `records.json`, `patch-set.json` and one patch
plus one preview per part: at most 258 pins. Final `candidate.json` metadata is
separate from that list and is committed last; it does not add a pin to itself.
Worker memory, time, queue, snapshot, protected-state, server-confirmation and
transaction guards are not enlarged. Large volumes do not guarantee that all
possible block states or every cell can be replaced within these byte budgets.

These limits address measured whole-asset conversion pressure without retaining
all serialized patch trees in the production Bridge. Synthetic capacity tests
and successful conversion alone do not certify client/server peak memory,
game-thread timing, full world apply/undo, real-model unattended completion,
architectural quality, Iris, physical IME or a release. Those require separate
evidence for the exact installed source and original final asset.
