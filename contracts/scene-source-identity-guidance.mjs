// Provider guidance only. It neither rewrites a rejected answer nor allocates
// ownership, geometry, references or placement permission on the model's behalf.
export function sourceIdentityGuidance(task, prior = null) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,11}$/.test(task?.id ?? '')) throw Error('Valid package identity required for source guidance');
  const prefix = task.id + '__', maximumIdLength = 32, collisions = [];
  let omittedCollisions = 0;
  for (const [collection, key] of [['components', 'id'], ['modules', 'id'], ['palette', 'role'], ['reservations', 'id']]) {
    const puts = prior?.response?.edit?.[collection]?.put;
    if (!Array.isArray(puts)) continue;
    if (puts.length > 256) throw Error('Rejected source guidance collection quota exceeded');
    const groups = new Map();
    for (const [index, value] of puts.entries()) {
      const id = value?.[key]; if (typeof id !== 'string') continue;
      const indices = groups.get(id) ?? []; indices.push(index); groups.set(id, indices);
    }
    for (const [id, indices] of groups) if (indices.length > 1) {
      if (collisions.length >= 32) { omittedCollisions++; continue; }
      collisions.push({collection, key, id, firstIndex: indices[0], repeatedIndices: indices.slice(1),
        currentLength: id.length, charsRemaining: Math.max(0, maximumIdLength - id.length)});
    }
  }
  return {version: 1, prefix, maximumIdLength, maximumNewSuffixLength: maximumIdLength - prefix.length,
    compactExamples: [prefix + 'w_n_01', prefix + 'w_n_24'], collisions, omittedCollisions,
    guidanceOnly: true, existingSourceIdsMustRemainExact: true, duplicatePutIdsForbidden: true,
    automaticRenaming: false, authorityExpanded: false, canAuthorizePlacement: false};
}

export const SOURCE_IDENTITY_RULES = `SOURCE IDENTITY: IDs have a maximum of 32 characters TOTAL, INCLUDING the exact task.id + "__" prefix. Read sourceIdentityPolicy.maximumNewSuffixLength; do not spend every character on a descriptive phrase and then lose the floor/wing/variant suffix. For new sources use short, meaningful stems and distinct numeric suffixes (the examples are naming examples, NOT geometry to copy). A real source ID appears at most ONCE in each put collection. Different floor selections, rooms or instances require different IDs unless represented by ONE valid reusable source/recipe. Replacing an existing source retains its exact original ID. Never trim or silently rename existing IDs. For a correction, sourceIdentityPolicy.collisions lists ambiguous IDs and put indices: choose distinct short NEW IDs for the actual intended objects, then repair ALL related references in at.relativeTo, host, allowOverwrite, module, representatives and recipes according to their intended geometry. Do not append suffixes past the 32-character limit, guess which ambiguous source a reference meant, drop required construction, or request broader ownership. This policy does not authorize automatic local renaming or world placement.`;
