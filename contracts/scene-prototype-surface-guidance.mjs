import {hash} from '../src/generation/compiler.mjs';

// Declaration-level guidance only. The saved cell/owner bundle and existing
// package check remain authoritative; this never assigns or transfers an owner.
export function prototypeSurfaceGuidance(scene, task) {
  if (!Array.isArray(scene?.components) || scene.components.length > 256
    || !/^[A-Za-z][A-Za-z0-9_-]{0,11}$/.test(task?.id ?? '') || !Array.isArray(task.editableComponents)) {
    throw Error('Validated scene and package required for surface guidance');
  }
  const owns = id => task.editableComponents.includes(id) || id.startsWith(task.id + '__');
  const surfaceSources = scene.components.filter(c => ['mass', 'profileMass', 'roomZone', 'storeyRoom'].includes(c.kind))
    .map(c => ({id: c.id, kind: c.kind, host: c.host ?? null, floorMaterial: c.floorMaterial,
      taskOwnsSource: owns(c.id), actualCellOwnershipVerified: false}));
  const layoutFields = ['face','edge','margin','start','count','step','size','columns','floors','insets',
    'borders','recess','projection','sill','shade','exclude'];
  const hostedFacadeSources = scene.components.filter(c => ['facade','panelFacade','edgeFacade','storeyFacade'].includes(c.kind))
    .map(c => ({id: c.id, kind: c.kind, host: c.host, sourceDeclarationHash: hash(c),
      hostKind: scene.components.find(host => host.id === c.host)?.kind ?? null,
      taskOwnsSource: owns(c.id), taskOwnsHost: owns(c.host),
      layout: structuredClone(Object.fromEntries(layoutFields.filter(key => Object.hasOwn(c,key)).map(key => [key,c[key]]))),
      sourceDeclarationsOnly: true, actualCellOwnershipVerified: false,
      hostFitIsNotPackagePermission: true, automaticOwnershipTransfer: false}));
  return {version: 2, sourceHash: hash(scene), task: task.id, surfaceSources, hostedFacadeSources,
    sourceDeclarationsOnly: true, actualOwnersMustBeInspected: true, regionsStillRequired: true,
    implicitHostPermissionIsNotPackagePermission: true, automaticOwnershipTransfer: false,
    guidanceOnly: true, authorityExpanded: false, canAuthorizePlacement: false};
}

export const BLUEPRINT_SURFACE_RULES = `INTERIOR SURFACE RESPONSIBILITIES BEFORE FREEZE: an interior region alone does not give a later task ownership of its existing slabs, walls or clearances. roomZone/storeyRoom write the floor finish AND room clearance even when the material stays identical. If a future interior task needs these operations, establish appropriate bounded task-owned finishing/room sources in THIS blueprint and assign their exact existing IDs to that task. Allocate the complete seed and every intended expanded floor, with separate sources for different package responsibilities; do not give a structural host to multiple tasks or let the typical-floor task seize public/technical floors. These are designer-chosen sources, not a stock office layout or completed furnishings. Preserve the selected massing anchors, real floor schedules, protected shafts, routes, reservations and interfaces. Sources must fit the actual host interior and avoid other protected geometry. If a later task will only add furniture/partitions into furnishable air, it may instead preserve the existing slabs and hosts exactly. Make this choice deliberately now; later allowOverwrite, a host reference or a namespaced ID cannot grant missing frozen ownership.`;

export const ROLE_SURFACE_RULES = `READ prototypeSurfacePolicy BEFORE CONSTRUCTING ROOMS: it lists source declarations, NOT a verified cell map or a permission grant. The accepted cell/owner bundle and task regions remain authoritative. A roomZone/storeyRoom creates a floor finish and takes clearance ownership; even unchanged floor materials or unchanged air do not authorize taking another source's slab/clearance. Refine an already task-owned room/finish source when the blueprint allocated one. Otherwise preserve protected slabs/hosts and construct deliberate furnishings/partitions only in actually furnishable air, without laundering the whole room through a new roomZone. A different allowOverwrite list cannot fix frozen package scope. Do not claim a protected host, move floors, add ownership, widen regions, erase required room functions or treat an unavailable cell as air. Check every expanded instance, not only the typical floor. This guidance performs no automatic block edit and does not waive the compiler, owner check or navigation checks.`;

export const BLUEPRINT_FACADE_SURFACE_RULES = `FACADE SURFACE RESPONSIBILITIES BEFORE FREEZE: design and allocate the full intended facade language in this blueprint, including its actual aperture widths, bays, depth layers, opaque bands, corners and exceptions. A later facade package can refine its assigned facade/detail sources, not unassigned structural shell cells merely because those cells lie in its region. If the intended manufacturing work changes a currently unallocated host surface, establish deliberately bounded task-owned facade/detail sources and assign their existing IDs NOW, with complete seed/expanded coverage, instead of leaving a narrow initial window strip and promising wider openings later. Preserve the selected massing, structural slabs, core, protected routes, entrances and other roles. Do not assign one whole structural host to multiple packages or replace original architecture with a stock facade. The compiler and original cell/owner checks still decide which changes are legal; this is design guidance, not an ownership grant.`;

export const ROLE_FACADE_SURFACE_RULES = `READ prototypeSurfacePolicy.hostedFacadeSources BEFORE EDITING A FACADE: each exact source declaration identifies its host separately, with taskOwnsSource and taskOwnsHost. Owning an opening array does NOT own the remainder of its host shell. Fitting inside a host or approved region, implicit hosted permission, allowOverwrite and a new task-prefixed ID cannot authorize touching a protected host. Changing start/count/step/size/face/edge/recess/borders/insets/projection or exclusions can change the actual cells and owners, even if material stays the same. Inspect original saved ownership and prior scope feedback, not just panel bounds. When splitting a repeated facade into seed sources plus recipes, preserve the original task-owned lateral footprints, host layer, floor/opaque-band exceptions and all intended rows unless the original task already owns the proposed changed cells; every expanded instance is checked. For a protected-owner failure, redesign the actual offending geometry against the SAME accepted baseline, rather than adding overwrite permission, widening scope, renaming the host or claiming the whole shell. Use allocated surfaces and actually available air for purposeful design refinements; preserving safety does not require unchanged visual composition or prohibit legitimate changes already owned by this task. No automatic clipping, shrinking, repainting, owner transfer or world-write authority is introduced.`;
