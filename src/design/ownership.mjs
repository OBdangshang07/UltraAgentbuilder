// Furnishing ordinary room air is not demolition. Deliberate voids, circulation
// clearances, existing solids and caller-owned revision locks remain distinct.
export const furnishableAirSource=source=>['mass','profileMass'].includes(source?.kind)||source?.kind==='roomZone'&&source.zoneUse==='room';
