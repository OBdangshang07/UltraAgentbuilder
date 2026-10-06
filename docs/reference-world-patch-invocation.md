# Canonical joint invocation identity

`contracts/reference-world-patch-invocation.mjs` formalizes the existing
`FrozenReferenceWorldPatchInvocationBinding` as an exact independent data
contract. Its version/purpose and original capsule, manifest, task, request,
snapshot, selection, reference owner/set, runtime and image-capability pins
cannot be replaced with legacy text-patch or reference-generation input.
Digest and owner fields require actual strings; extra paths, pixels, model
overrides or authority are rejected. Canonical field order retains the original
journal fingerprint even if incoming JSON fields have a different order.

The private SEND-input builder uses this contract without changing its existing
descriptor bytes, ordered-image hashes, prompt/schema or fingerprint semantics.
Constructing or comparing the descriptor is data equality only. A receipt must
first come from the checked private original-source reader; these helpers do
not authenticate arbitrary JSON or create consent/call/world permission.

This does not add provider transport, a consume-once SEND registry, live model
capability verification, durable reservation, HTTP/UI or game integration.
The current Codex image handler still accepts only its existing native-review
and `JobReferenceInput` workflows. A separate verified joint adapter/runner
path remains required; passing this descriptor through that legacy handler is
not real multimodal support. Existing active frozen tasks are not upgraded.

Authored synthetic tests compare the previous exact descriptor bytes and
fingerprint, field-order normalization, every pin/type, cross-protocol and
authority rejection. No provider or world write is exercised:

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-invocation.test.mjs tests/bridge/reference-world-patch-send-bindings.test.mjs tests/bridge/reference-world-patch-task-images.test.mjs tests/bridge/reference-world-patch-image-worker.test.mjs
```
