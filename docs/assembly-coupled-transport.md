# Complete coupled assembly transport (data-only)

`CoupledAssemblyBinding` version 1 is an independent format. It is not an
upgrade of legacy `AssemblyPatchBinding`, an old SEND, or a placement permit.
It pins the original selection, context revision, native asset and cells,
source identity, whole coupling policy/plan/schedule, and every original
part and preview. Complete native manifest, cells and plan are mandatory.

The Node producer accepts only the original completed stream and previews
owned by the same opaque plan. JSON copies, equal hashes and partial streams
do not acquire that identity. The Java receiver owns defensive copies,
checks per-file and aggregate quotas, and independently reconstructs all
operations, previews and the complete set against the original sealed
server baseline. A single transport part is never an application scope.

Targeted validation: 154 Node tests, 4 Java suites / 26 tests, syntax,
publication checks and a candidate build passed on an immutable source copy.
An independent package audit checked every bundled source and generated
member. These are not full-regression or installed-game acceptance results.

No new candidate publisher, HTTP download, UI, server consent, native world
gateway, journal execution or protected undo is connected by this milestone.
All model-send, placement, server-baseline and physics authority flags remain
false. Existing coupled BEFORE states remain protected. No original failed
model task was resumed, substituted or rewritten.
