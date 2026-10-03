// Stage responsibilities must not contradict each other. Concepts are diagnostic
// exterior/spatial studies; the full-plan stage still owns all required function.
export const CONCEPT_DESIGN_RULES=`CONCEPT STUDY ONLY — design full-scale alternatives through silhouette, facade hierarchy, negative space and coherent base/entry/crown. Show real materials, depth and readable elevation rhythm; a colour swap or feature label is not a design. Avoid unjustified copper defaults, opaque blocks described as glazing and full-wall glow. Allocate plausible volume for the future core, typical offices and special public space, but DO NOT construct roomZone/storeyRoom layouts, repeated services or furniture at this stage. Those belong to the selected full plan, which MUST retain the user's complete interior and circulation requirements. Floors needed for the visible elevation may be represented, but detailed floor programs are deferred. A spatial void and a reservation serve different purposes: reservation.allowedComponents does not replace allowOverwrite for an explicitly cleared void. Authorize only the actual intended intersections. Do not fill requested negative space, crop geometry or reduce height to pass. These studies are never placeable or proof of working circulation.`;

export function assemblyStageGuidance(phase,geometryRules,qualityRules){
  if(['concepts','correct-concepts','concept-candidate','correct-concept-candidate'].includes(phase))return {
    geometry:geometryRules.replace(/\n## Architectural function\b[\s\S]*?(?=\n## |$)/,'\n'),
    quality:CONCEPT_DESIGN_RULES,
  };
  if(['assembly-blueprint','correct-blueprint'].includes(phase))return {geometry:geometryRules,
    quality:'STRUCTURAL BLUEPRINT ONLY: retain the selected full-scale composition and establish actual floors/core/entry/interfaces plus explicit deferred design responsibilities. The four detailed representative studies are constructed in separate later calls. Do not return them all here or claim the blueprint is furnished architecture. No stock geometry, reduced height or world authority.'};
  if(['prototype-role','correct-prototype-role'].includes(phase))return {geometry:geometryRules,
    quality:'ONE PROTOTYPE RESPONSIBILITY ONLY: construct the selected task role in the coherent chosen language. Other roles are retained byte-for-byte. Full-floor organization, facade depth, street scale and crown quality are actual design requirements, not a component-count score. Unshown areas remain unverified; this delta is never a completed building.'};
  // Selection ranks existing evidence; it must not receive instructions to build
  // room layouts or representative prototypes in a selection-only response.
  return {geometry:geometryRules,quality:phase==='select-concept'?'':qualityRules};
}
