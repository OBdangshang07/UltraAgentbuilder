# Joint reference-and-selection SEND binding foundation

This milestone is **private preparation data, not a model dispatcher, HTTP
feature or installed player workflow**. It follows the immutable joint capsule
and leaves all existing text-patch and reference-building protocols unchanged.

`contracts/reference-world-patch-send.mjs` defines a new independent
`FrozenReferenceWorldPatchExplicitSend`. Its exact purpose/version, confirmation
and one-call budget bind the committed capsule/manifest, reviewed task/prompt,
original confirmation, snapshot/selection, selected pictures, runtime and image
advertisement. Digest fields must be actual strings, not coercible arrays or
objects. Legacy confirmations, reviews, receipts and SEND shapes are rejected.
This pure equality contract is not a credential authenticating arbitrary JSON;
the receipt must originate from the checked private source reader.

`bridge/reference-world-patch-send-input.mjs` rereads the committed original
sources, independently binds the new SEND and constructs a private data packet.
It preserves the original exact model prompt, proposal schema, world baseline
identity and ordered original image hashes. The journal's existing canonical
invocation fingerprint helper binds the image contents, joint source/runtime,
phase, schema and one-call budget, not temporary filenames. It does not encode
new images, look up caller paths or attach pictures to the legacy text request.

The bounded context worker exposes internal `reference-patch-send-input` and
`reference-patch-original-input` operations. They accept at most 4096 bytes of
exact SEND data and do not recreate a discarded context store. New binding
checks current capture expiry before and after preparation. Original-only audit
may reconstruct the original fingerprint after expiry, without refreshing the
capture, enabling a new call, or asserting a current world baseline. The mode
switch is internal; adding it to the submitted SEND is rejected.

Every returned packet remains `modelSent=false`, `sendingImplemented=false`,
`liveProviderCapabilityVerified=false`, `serverBaselineVerified=false`,
`canAuthorizePlacement=false` and `allowsNewModelCall=false`. It contains the
exact private prompt, so it must never be returned by a public HTTP route.
There is no provider access, call reservation, consume-once consent registry,
world write, token cap or hidden picture-analysis call in this milestone.

Production must still persist the new exact independent SEND and write-ahead
invocation, check current selected-provider image/effort capabilities and the
same runtime, freeze/reverify original pixels in a task-owned transport, and
retain unknown outcomes without resending. Existing response compilation must
then use the same original BEFORE/neighbor facts, with a separately versioned
joint provenance artifact and player difference preview. Fresh server checks,
explicit world-write confirmation, protected undo and saved-world acceptance
remain separate. This source foundation does not certify those missing gates.

Synthetic tests use authored pixels and block facts only:

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-send-bindings.test.mjs
```

They cover exact ordered-picture fingerprinting, all SEND pins and digest types,
cross-protocol/authority rejection, original expiry/discard and audit, unknown
facts/protection, source corruption, byte/UTF-8/cancellation/closed-lane bounds,
and zero-provider/no-public-route behavior. They do not prove that a real model
saw pictures, designed an adequate building or completed a game transaction.
