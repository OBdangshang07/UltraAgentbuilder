# Reference images in the world-patch editor

The local PNG/JPEG editor is shared by ordinary reference buildings and the
world-patch task page. Its optional pixel-only target does not synthesize an
ordinary building request, choose a model, inherit a budget or transfer consent.
Crop, rotation, ordering, annotation, normalized preview and explicit local
save/restore retain their original implementation.

The world-patch page can explicitly attach the exact prepared picture set or
choose the original text-only route. Changing an image, prompt, world, selection,
context or model invalidates the relevant joint review. Detaching pictures is an
explicit choice, never an automatic fallback after an error.

## Pure local preparation

- `GET /v1/reference-pixels/capabilities` declares no discovery, model calls,
  world writes or consent transfer.
- `POST /v1/reference-drafts/<owner>/pixels` accepts only a version-1
  `ReferencePixelPreparationRequest` with `upload`. Model, task, budget,
  capability, path, URL and confirmation fields are rejected.
- `GET /v1/reference-drafts/<owner>/sets/<setHash>` reads the exact canonical
  `UserReferenceSet`; `.../images/<imageId>` reads its checked original PNG.

The existing bounded off-thread reference lane and four-set quota are shared.
No additional preparation or confirmation record is created. The canonical
manifest commits last; partial/corrupted sets are not repaired or substituted.
The existing explicit archive contract also supports a pure-pixel owner.
All routes retain paired loopback authorization, byte/pixel bounds and exact
method/query checks. Original source paths and metadata are not transported.

Java independently checks the local snapshot, manifest, ordered records, decoded
pixels and a final manifest reread. Failed/closed/stale preparation cannot be
adopted as the current attachment; stored original data is preserved.

## Joint content review, not full generation

The task page discovers the explicitly selected Codex model's image capability
and exact effort separately from the joint disclosure. Only the verified
manifest and original context can reach the existing joint disclosure/freeze
protocol. The content page shows picture hashes/annotations and bounded pages
of the complete original model input. Confirmation freezes that joint content
with zero model calls; it neither sends a model nor changes a world.

The current process-owned joint protocol remains default-disabled in normal
startup. The new page has **no joint SEND button**. Its development contract is
still at most one call, not Lite/Pro/Max/Ultra. Player budget/SEND/history/result
integration, the complete shared design pipeline and exact-package game/real
multimodal acceptance remain required. This source milestone is not a release
certification or a claim that the overall roadmap is complete.

Free synthetic tests exercise the production HTTP and Java preparation lanes,
exact image transport into joint freeze, malformed and duplicate JSON, original
set corruption, capacity, cancellation and legacy preparation compatibility.
These are not evidence of real model quality or in-game UI presentation.
