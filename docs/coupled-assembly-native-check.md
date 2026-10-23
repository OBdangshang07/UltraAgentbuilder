# Native pending-group oracle (no world authority)

This helper reconstructs exact canonical registry states and asks actual
Minecraft 1.20.1 `canPlaceAt` rules about the complete pending AFTER group.
Matching door halves are checked together, including all matching properties.
Forward order is lower/upper; the protected inverse uses upper/lower.

The virtual view supplies pending states, original height bounds and explicit
caller-provided reads only. Unknown methods/reads fail closed; it never
forwards an unknown call to a chunk-loading world API. In particular, the
upper can see its pending matching lower before either member is written.
Support is still the real native UP-face shape, not a client support flag.

This is not a world Source, original Capture lease, final confirmation or
installed-game test. The future server Source must constrain every supplied
read to the same original loaded chunks and context, retain exact authorized
rows, and perform all original group/neighbor/revision checks. Neither the
helper nor a successful oracle result grants placement or proves physics or
physical persistence. Existing static routes remain unchanged.
