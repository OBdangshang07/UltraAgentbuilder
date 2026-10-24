# Preserve reviewed native block interpretation

A native cell stores a palette index, not a block name. The same binary and
cell hash can therefore describe different materials after a palette change,
or different coordinates after a dimension change. Internal bundle hashes
alone do not prove equality with the asset supplied to the final review.

Candidate preparation now compares the reviewed and final native schema,
Minecraft/data versions, dimensions, complete ordered palette, SET/CLEAR counts
and exact binary/source identity before emitting candidate members or claiming
publication. Intentionally different diagnostic/quality status metadata does
not need to be equal. All existing ledger, reference, render, complete package,
original source and post-publication evidence checks remain required.

A new synthetic complete-task counterexample reproduced the original gap:
the final bundle's palette and its self-consistent manifest hash changed,
while original cell bytes and reviewed source remained the same. The old
publisher accepted it. The original red test and its frozen inputs are retained
privately. This is not evidence that an earlier real task had that mismatch,
nor a diagnosis of its unrecorded original exception.

This check does not grant model retries, world permissions, old task adoption,
native physics or persistence certification. The new coupled workflow still
needs its original owner, complete terminal proof, candidate/HTTP/client path
and independently confirmed server transaction.
