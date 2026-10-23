# Whole-native coupling analysis (foundation only)

`src/world/assembly-coupling.mjs` adds the independently versioned, read-only
`AssemblyCouplingAnalysis` v1 (`whole-native-new-door-analysis-v1`). It does not
change WorldPatch v1, the current assembly candidate, SEND, consent, transport,
Java compiler, placement, journal or undo formats. Production lowering still
rejects doors and trapdoors. This milestone is **not the complete repair**.

The analyzer owns the original eligible native bytes and validates dimensions,
palette indices, hashes and actual set/clear counts before reporting anything.
Only occupied palette entries are checked as target states; an unused default
door or leaves entry is not geometry. Coordinates translate only from the
original W minimum. Explicit CLEAR stays demolition; omitted cells stay KEEP.

Every proposed change must use known original W facts outside P. All six
neighbors must have captured, known C facts. Existing coupled BEFORE states,
block entities, fluids, unclassified blocks, legacy-restricted neighbors and
adjacent BEFORE stairs remain rejected. This does not yet enable group-aware
editing of existing doors or other coupled blocks.

Door groups are built from the entire native AFTER, not provisional parts.
Both halves must be explicit native cells of the same material, facing, hinge,
open and unpowered state. The lower half's final support comes from explicit
native SET/CLEAR or original known KEEP facts, including captured support below
the native bounds. Missing or partial support is rejected, never filled in.
The conservative UP-face support whitelist includes approved full cubes,
top/double slabs and top stairs, verified against Vanilla 1.20.1 shapes by an
independent Java test. The analysis is not a runtime server physics check.
Trapdoors retain their explicit state without an invented attachment rule.
Leaves and light state resolution remain unsupported.

The report binds the original snapshot, selection, native asset and cells.
Validation rebuilds the entire analysis; rehashing a saved report does not make
it trusted. Results are immutable, disclose zero writes and no placement
authority, and expose no partial groups on failure or cancellation.

Synthetic tests include a door whose halves cross the 8192-operation transport
boundary, mismatched halves, changed/cleared/KEEP support, negative coordinates,
unknown neighbors, P, unsafe BEFORE, state preservation and legacy refusal.

Still required before production support: independently versioned Node/Java
whole-candidate verification and confirmation binding; complete coupled-group
scheduling across parts/batches; cancellation, crash-ambiguous recovery and
player-edit-preserving undo; capability/prompt alignment; installed UI/Iris and
same-asset placement/save acceptance. A successful analysis cannot substitute
for those gates or revive a previously failed job.
