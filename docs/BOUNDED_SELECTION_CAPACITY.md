# Bounded large-building selection capacity

The shared Java/Bridge selection contract permits 2,097,152 context cells and
1,048,576 edit cells. Coordinates remain minimum-inclusive / maximum-exclusive.
This admits the complete 64 x 64 x 224 edit box (917,504 cells), with surrounding
read-only context; it does not narrow, relocate or crop the requested building.

These are **selection volumes**, not promises that every cell can be replaced.
The 16 MiB snapshot, 4,096 states per chunk, 1,024 intersecting chunks, original
axis/dimension bounds and protected-region limits remain independent. High-
entropy captures can still fail the byte guard, with no partial/air substitute.

Production reads still visit only already-loaded chunks and retain the 4,096-
cell / 2 ms cooperative tick schedule. Unknown chunks stay unknown. Capture
finalization runs on the bounded background worker. Synthetic clock tests prove
work-count boundaries, not real-world frame times or preemption of a slow read.

Complete assembly patch transport derives its part-count ceiling from edit
capacity: at most 128 parts of 8,192 operations. The 64 MiB aggregate patch and
100 MiB client download quotas remain unchanged; per-part byte limits also
remain. A dense result can hit these independent limits before the count quota.
There is no partial adoption, byte-quota override or permission to build parts
individually. This capacity step is not full large-asset transaction acceptance.

Selection, source/asset hashes, exact BEFORE facts, six captured neighbors,
protection, fresh server checks and explicit final world confirmation are still
required. Model generation or a preview is not permission to write a world.
Synthetic capacity tests are not architectural-quality, physics, Iris, physical
IME, real-model unattended completion or certified-release evidence.
