# Installed original-FINAL world gates

## Normal rendering — passed on 2026-10-06

This check used the installed 0.4.10 Alpha production JAR built from source
`595cd64045f405971db84e18ffddc8fce1b7b347`. It does not certify other source
commits or a release. The JAR SHA-256 was
`6f5f072b90df0e3ab5bdf15833202d4208e11954d882c1693f595e8e9c8440b6`.

A previously completed real-model task's original 64 × 224 × 64 native FINAL
was imported through the normal UI into a new isolated creative world. The
geometry was not recompiled or substituted. No model was called during this
world check, and no player's existing world was opened or copied.

The isolated fixture used `randomTickSpeed=0` to keep the saved-state comparison
deterministic. This is not evidence for every naturally changing world state.

The installed game completed real world projection, locked placement through
the normal confirmation UI, full undo, partial-placement cancellation, partial
undo, save and normal exit. A separate read-only saved-world check passed:

| Check | Observed result |
| --- | --- |
| Projection | 345 actual mesh draws; preview remained read-only |
| Full placement | 172,081 changes, including one deliberate clear-cell baseline |
| Full undo | 172,080 restored; one later player edit preserved |
| Cancellation and undo | 1,024 partial changes restored, zero conflicts |
| Original native footprint | All 917,504 cells checked, including keep and clear |
| Final saved footprint | 917,503 restored; one protected later edit retained |
| Native state comparison | Complete registry-resolved properties, rotation and mirror checked |
| Lifecycle | Original game and built-in Bridge exited; exclusive test ownership retired |

The asset, production JAR and frozen test sources were checked again after the
run. Audit checks did not write to the world or issue model calls.

## Iris rendering — passed on 2026-10-06

A separate new installed-game fixture used the same original FINAL and the
same production JAR with Iris 1.7.6, Sodium 0.5.13 and Derivative d24.4.14.
The shader pack was actually active, not merely installed. The captured world
projection was visible under the shader; its camera cropped the upper tower,
so this is not a full-height presentation or visual-quality certification.

The game recorded 330 actual projection mesh draws, 172,081 placement changes,
172,080 undo restorations and one preserved later edit. Cancellation restored
all 1,536 partial changes with zero conflicts. The independent saved-world
audit again checked all 917,504 original footprint cells and the exact native
block properties, rotation and mirror. The final world retained only the
deliberate later edit. Shader resource hashes, frozen tooling, original game
and Bridge exit, and retired ownership were independently checked after the
outer test passed. No new model calls or existing-world access were involved.

This proves this exact shader/JAR/asset combination, not all Iris versions,
shader packs, hardware, changing-world physics or performance targets. The
fixture also used deterministic `randomTickSpeed=0`.

## Limits and remaining gates

This is an original-FINAL import/world-transaction gate, not the stronger
same-player-session generation-to-placement gate. It is not an architectural-
quality or circulation certification, an exhaustive
crash-recovery test, or permission to place anything in a player's world.
Normal in-game checks and explicit placement confirmation remain required.

The original real-model task completed with 23 reserved calls and 23 returned
receipts, but took approximately 6 hours 18 minutes. Its facade repetition and
simple crown do not meet the intended CBD design-quality target. A successful
world transaction must not be presented as solving generation speed or design
quality. Earlier failed or unknown runs remain separate outcomes.

Next gates are independent zero-SEND consent testing of the future same-session
helper, then a new bounded
real-model same-session test. Selection/context, multimodal integration,
quality, performance and release gates remain open.

Private model answers, invocation records, test tooling, screenshots and worlds
are deliberately not included in this public repository.

## Separate documentation-branch CI status

The first documentation-only publication commit passed 11 local branding and
publication tests and the public-content guard. Its independent CI Java job
subsequently failed one synthetic original-image restore client test with an
8-second future wait timeout. This failure is retained; its scheduling or
transport cause is not yet established. It is not a real-model failure, but
the documentation branch must not be advertised as having passed full CI.
That CI run is separate from the tested source commit and the installed-game
evidence above.
