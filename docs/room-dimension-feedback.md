# Explicit room dimensions and correction evidence

`roomZone` and floor-derived `storeyRoom` validate the interior left by their
actual one-cell boundary planes. X width must be at least `1 + west + east`;
Z depth must be at least `1 + north + south`. Each declared face contributes
one, and an omitted side contributes zero. Door openings do not discount walls.
Four-sided rooms still need at least 3x3 total cells. A 2x4 north/south/west
room leaves a 1x2 interior without changing its geometry; west/east partitions
in a two-cell width leave no interior and still fail.

This replaces the formerly conservative blanket 3x3 test, not containment,
floor/ceiling, opening, ownership, protection or circulation validation. The
emitter is unchanged, and previously valid rooms retain their geometry. This
is not permission to omit required walls, services or circulation, or a claim
that a small room fits its requested furniture or architectural program.

The SceneSpec prompt and schema descriptions state this conditional rule,
the opening side margins and floor-inclusive height arithmetic. The schema
still accepts narrow unpartitioned zones and keeps the original field families.

Rejected geometry now includes `roomZoneFeedback` with exact dimensions,
minimum footprint, actual interior bounds, invalid axes and boundary faces, or the exact opening,
span and allowable side/head margins. Floor-derived rooms retain these details
inside `layoutFeedback`, including the original floor/row identity. Compact
model feedback preserves the same evidence.

No component is moved, enlarged, clipped or approved by this feedback. The
model must submit an explicit valid correction within its existing scope and
budget, and the full compiler still checks ownership, containment, floors,
protection and circulation. This does not add model calls or alter old tasks.
An exhausted recovery budget still stops safely; scheduling reserves require
separate validation. Synthetic compilation tests are not a real-model or
installed-game stability certificate.
