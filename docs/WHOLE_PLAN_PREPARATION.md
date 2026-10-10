# Whole-candidate preparation lifetime

The read-only whole-candidate journal plan is a CPU stage, not an acknowledged
disk write. Large bounded candidates can take longer than the 30-second disk
receipt deadline to independently reconstruct every original part. The CPU
stage now has a separate 180-second total budget on a bounded worker lane.

All original Capture, proposal, patch and preview bytes remain checked. No
partial plan, replacement asset, unknown-as-air fallback or automatic replay
is accepted. Cancellation and expiry revoke the result; a cancelled original
worker must actually close before its server can start a new preparation.
Late work never issues confirmation, writes a journal or modifies the world.

The 30-second disk receipt protections and 45-second independent final consent
remain unchanged. Closing a preparation screen does not grant world-write
authority. The live server lease is still checked after CPU preparation and
again at the independent explicit placement confirmation.

Synthetic lifetime and cancellation tests do not certify full installed-game
apply/undo, later-edit preservation, performance, model quality or release
readiness. Large download latency remains a separate unresolved performance
gate; increasing the CPU budget is not a performance acceptance result.
