# Reference pictures with bounded world edits: preparation foundation

This source milestone adds a data-only joint preparation/review contract. It is
**not a player feature, SEND endpoint, installed candidate or release acceptance**.
The existing text patch, reference-building generation and world-write protocols
remain unchanged. The new contract is not wired into their endpoints.

The implementation is `src/world/reference-world-patch-design-task.mjs`.
It prepares a new `ReferenceWorldPatchDesignPreparedTask` from a validated
context snapshot, the selected canonical reference pixels, a new joint intent,
the selected model's image/effort advertisement and a runtime hash.

## What preparation verifies

- The original world-patch baseline, absolute coordinates, read-only context,
  inner edit scope, protection and captured six-face neighbors are retained.
  The original block-facts prompt is preserved, not replaced by an image summary.
- One to four selected canonical reference images are redecoded and rebuilt.
  Their exact bytes, dimensions, annotations, mode, owner and set hash must
  match. No file paths, URLs, metadata-bearing images or omitted pictures are
  accepted as pixel inputs.
- The selected Codex model must advertise image support and any selected
  non-default effort. A bound advertisement is not an independently verified
  provider receipt; production must still check actual current capabilities.
- Recipient, effort, task text, runtime, snapshot, reference set and declared
  capabilities bind the request and confirmation. Changes invalidate old review.
- Legacy text-patch and reference-generation confirmations cannot become joint
  confirmations. The new review also cannot become a legacy SEND or world-write
  approval.
- Picture content and captions are quoted untrusted design evidence. They do
  not enlarge the edit scope, replace BEFORE states or authorize tools/accounts.
  The unchanged patch compiler remains responsible for checking real operations.

The preparation retains the text patch's one-call budget. It adds no hidden
image-analysis call and imposes no new model output-token cap. Pixel/data quotas
are separate. More elaborate multi-stage edits need a separately designed and
explicitly funded protocol, not an automatic upgrade of this contract.

Every prepared/reviewed object remains `modelSent=false`,
`sendingImplemented=false`, `serverBaselineVerified=false` and
`canAuthorizePlacement=false`. This artifact is not a consent registry or an
opaque proof that source files or current server state were checked.

## Still required for the actual feature

The follow-up [stored-source preparation](reference-world-patch-source-preparation.md)
adds internal bounded-worker reading and expiration checks. It still adds no
public route, provider call, capsule or player UI. Production integration must
check current capabilities, freeze a new versioned joint capsule, and persist exact source,
pixel, prompt/schema, budget and invocation identities. SEND must be consume-once,
preserve unknown outcomes and never borrow legacy confirmation. No images may
be silently inserted into the existing text-only capsule.

The UI still needs a unified reference/context disclosure and explicit consent.
The installed version then needs real exact-picture transport and one closed
joint task, followed by the same patch's difference preview, fresh server BEFORE
checks, separate world-write confirmation, protected undo and saved-world audit.
Full quality, performance, installation and release gates remain separate.

Run the synthetic contract tests with:

```sh
node --test tests/design/reference-world-patch-task.test.mjs
```

They use authored pixels and block facts, not private model answers, worlds or
screenshots. Passing them does not prove a model has seen pictures, an actual
Minecraft transaction has succeeded or the complete roadmap is delivered.
