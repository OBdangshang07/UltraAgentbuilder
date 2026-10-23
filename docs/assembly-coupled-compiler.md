# Complete coupled-plan compiler (not yet a world writer)

The independent `AssemblyCoupledPlan`/`AssemblyCoupledPart`/
`AssemblyCoupledPatchSet` v1 formats preserve the complete original native
asset and selection while allowing data-only analysis of new matching doors,
trapdoors, stairs and slabs. They are **not** legacy WorldPatch v1, a candidate,
SEND confirmation, placement consent or an executable journal.

`src/world/assembly-coupled-plan.mjs` owns the original manifest and cell bytes,
runs complete coupling/support and BEFORE/six-neighbor checks before part zero,
then streams fixed-size provisional transport parts. Every part binds the whole
plan; a copied report, part or matching hash cannot become its opaque compiler
input. CLEAR remains explicit, omitted cells remain KEEP, and no coordinates
are relocated, clipped, rotated or rescaled.

The fixed `contracts/assembly-coupling-policy.json` resource is shared with Java
and identified by a policy hash. It retains legacy BEFORE protection, excludes
unresolved leaves/light targets, and admits only unpowered, dry approved target
states. Its conservative support policy is distinct from general Vanilla
collision or attachment behavior. Top/double slabs and top stairs may supply a
full UP face; trapdoors are not admitted as door supports by this policy, but
do not acquire an invented attachment requirement themselves.

Transport preserves native y-z-x order and the 8192-operation part boundary.
Execution grouping is separate: each new door's upper operation is promoted
immediately after its lower operation. Sparse pair metadata defines this order
without retaining a second volume-sized schedule. Every operation appears
exactly once. This is a **required future executor/journal rule**, not proof
that the production world writer currently applies it.

`AssemblyCoupledCompiler` independently rebuilds the whole analysis, plan,
schedule, original guards, parts and set from a server-owned sealed baseline
and the original native manifest/cells. It does not trust downloaded pairs,
state assertions or hashes alone. The constructor of its compiled result is
private. Returned JSON is defensive data, not write authority.

Free synthetic Node/Java tests compare complete objects and hashes for valid
and invalid cases, including crossing a transport boundary, interleaved pairs,
negative coordinates, captured support, explicit demolition, UNKNOWN neighbors,
P, unsafe BEFORE, cancellation and rehashed tampering. Native shape tests check
admitted support states against Minecraft 1.20.1. These compiler tests are not
installed-game, Iris, placement/save or release acceptance.

Still required: explicit new preparation/candidate/preview/consent bindings;
production native-source support checks; group-aware application, intent and
receipt boundaries, cancellation, ambiguous-failure handling and protected undo;
prompt/capability alignment; installed UI/Iris and same-asset placement/save
gates. Existing coupled BEFORE editing remains protected and still needs its
own validated closure policy for environment-aware renovation. The old task
and protocol are never silently upgraded or adopted.
