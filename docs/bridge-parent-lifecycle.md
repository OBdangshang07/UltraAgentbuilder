# Bridge parent presence

The normal companion CLI can receive `--parent-pid <positive PID>`. A successful
signal-zero probe means that PID is present. Only the explicit `ESRCH` result
establishes absence and requests the existing Bridge's normal shutdown. An
access-denied, timeout, unavailable probe, or unexpected result remains unknown;
it does not cancel generation, restart a process, or resend a model request.
Repeated identical uncertainty is logged once until a successful read or a
different uncertainty. No exception message or account content is logged.

Invalid and duplicate parent arguments fail before Bridge startup. The watcher
does not signal the parent, replace a task, or authorize recovery or world writes.
This PID-only check does not prove process creation identity and cannot certify
that an absent parent exited normally. Native rendering crashes, loss of a
client renderer, safe handling of already-submitted turns, original-asset world
transactions and saved-world verification remain separate acceptance gates.

Synthetic parent-probe regression and normal CLI sentinel shutdown cover this
behavior. They are not a complete game, model-quality or release certification.
