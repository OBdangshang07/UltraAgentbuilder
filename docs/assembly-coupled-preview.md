# Plan-bound coupled preview data

`WorldPatchPreview` v2 is an explicit read-only display protocol for an
`AssemblyCoupledPlan`. Its identity adds `couplingPlanHash` and
`couplingPolicyHash`; `patchHash` identifies the original provisional coupled
part. It retains fixed absolute world coordinates, explicit CLEAR, omitted KEEP,
and separate original/proposed geometry. A displayed half-door does not become
an independently valid patch or application scope.

Node requires the original opaque complete plan and a part produced by that
plan's checked stream. A JSON copy, another plan's part or a matching hash is
not a verified input. Full native pairing, support and original-neighbor checks
therefore precede every display part. Saved preview validation rebuilds from
those original inputs rather than accepting a self-rehashed display.

Java requires an explicitly coupled expected binding. Legacy six-field bindings
still select v1 and cannot adopt v2; v2 cannot enter the old static compiler or
legacy whole-part constructor. Coupled data uses strict UTF-8/JSON parsing,
rejects duplicate fields and unused palette states, and cannot claim movable,
rendered, physics-verified, server-verified or placement-authorized status.

`AssemblyCoupledCompiler` verifies the parsed display against its independent
complete native reconstruction: plan/policy, snapshot, selection, original part,
all changed coordinates and exact BEFORE/AFTER states must agree. Parsing a
caller-rehashed display alone does not establish that agreement.

Sparse section layout is shared with the old static preview through a
geometry-only encoder. The old preview schema and policy remain v1; common
layout does not upgrade consent or make the two protocols interchangeable.

This milestone does not yet connect a new full candidate/preparation/consent to
the installed game, implement grouped native application/journaling/undo, or
prove actual projection visibility, Iris compatibility, placement or physical
world persistence. Those release and same-asset game gates remain required.
