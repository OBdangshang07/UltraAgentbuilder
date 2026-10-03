import {hash} from '../generation/compiler.mjs';
import {lowerScene} from './compiler.mjs';

export const RESERVATION_AUTHORITY_RULES = `reservationAuthority is an exact read-only summary of the CURRENT source, not a permission request. Package/prototype stages cannot put/remove reservations. A task purpose, region, allowOverwrite list or task.id+'__' namespace DOES NOT add an ID to a reservation.allowedComponents allowlist. Within a reserved volume, new solids must be produced by an already permitted AND task-owned source ID; refine that existing source or its module only when all consumers are owned. An allowed but foreign source is not editable. Alternatively design genuinely outside the reservation and inside task.regions, without bypassing protected solids/voids or frozen passage interfaces. If this task cannot implement its full responsibility under these permissions, report the precise conflict; do not repeat unauthorized geometry, acquire another owner, clear a reservation or erase required functions.`;

/** Derived from the same anchor resolver as compilation. No cell writes,
 * ownership transfer, reservation edits or candidate acceptance. */
export function assemblyReservationAuthority(scene, task) {
  if (!task || typeof task.id !== 'string' || !Array.isArray(task.editableComponents) || !Array.isArray(task.regions)) throw Error('Invalid reservation authority task');
  const prefix = task.id + '__', components = new Set(scene.components.map(c => c.id));
  const owned = id => components.has(id) && (task.editableComponents.includes(id) || id.startsWith(prefix));
  const lowered = lowerScene(scene);
  const intersects = (a, b) => a.origin.every((v, i) => v < b.origin[i] + b.size[i] && b.origin[i] < v + a.size[i]);
  const reservations = lowered.reservations.map(r => ({id: r.id, origin: [...r.origin], size: [...r.size],
    intersectsTaskRegions: task.regions.some(region => intersects(r, region)),
    allowedComponents: [...r.allowedComponents],
    permittedTaskOwnedSources: r.allowedComponents.filter(owned),
    permittedButForeignSources: r.allowedComponents.filter(id => !owned(id)),
    newNamespacedSolidsAllowedByDefault: false}));
  const data = {version: 1, sourceHash: hash(scene), taskHash: hash(task), task: task.id,
    reservationsFrozen: true, reservationsPutRemoveAllowed: false, namespaceDoesNotGrantReservationPermission: true,
    reservations, geometryChanged: false, scopeExpanded: false, canAuthorizePlacement: false,
    limitations: ['Source allowlists do not prove geometry fits the task regions, preserves other owners or existing voids, or respects passage interfaces.',
      'A permitted source or shared module still requires this task to own every edited source/consumer; no authority is acquired from this summary.']};
  return {...data, authorityHash: hash(data)};
}
