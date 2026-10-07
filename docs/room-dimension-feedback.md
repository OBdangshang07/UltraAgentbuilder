# Explicit room dimensions and correction evidence

`roomZone` and floor-derived `storeyRoom` retain the same geometry rules. When
`boundaries` is nonempty, both X width and Z depth must be at least three cells,
including the walls, even for a single partition. Only unpartitioned zones can
have one/two-cell widths or depths. This is not permission to omit required
walls, services or circulation.

The SceneSpec prompt and schema descriptions now state this conditional rule,
the opening side margins and floor-inclusive height arithmetic. The schema
still accepts narrow unpartitioned zones and keeps the original field families.

Rejected geometry now includes `roomZoneFeedback` with exact dimensions,
minimum footprint, invalid axes and boundary faces, or the exact opening,
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
