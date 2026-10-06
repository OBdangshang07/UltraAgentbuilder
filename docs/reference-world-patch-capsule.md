# Immutable reference-plus-world-patch preparation capsule

This is an internal source foundation, **not an installed player feature or
permission to send a model request or modify a world**. The existing text-only
patch and reference-building protocols remain unchanged. Joint preparation,
review and freeze are separate from their consent and invocation contracts.

`bridge/reference-world-patch-task-capsule.mjs` freezes the original context
payload bytes, ownership record, normalized snapshot and summary, the exact
selected canonical picture manifest and one to four pictures, the bound joint
intent/capability/runtime, baseline disclosure, joint disclosure, independent
joint confirmation and review. The internal context worker has bounded
`reference-patch-freeze-task` and `reference-patch-frozen-task` operations;
neither has an HTTP route, model adapter, call reservation or world-write API.

## Identity and lifetime

- Freeze rereads original fixed stored IDs and checks source ownership, bytes,
  hashes, coverage and lifetime. Caller paths, replacement facts/pixels and
  request-only approvals cannot substitute for those original sources.
- The deterministic capsule ID binds the original context identity/record,
  exact task disclosure, confirmation and review. Repeating the same freeze
  through the serialized worker returns the original committed artifact.
- Changes to the task, pictures, selection, recipient, effort, runtime or image
  advertisement require a new joint confirmation. A legacy confirmation or
  either protocol's capsule/receipt cannot be promoted into the other protocol.
- The baseline is disclosure DATA only. No fabricated legacy confirmation or
  review is archived to obtain the existing text-only SEND rights.
- Account/path/token hints in a capability object are not persisted. The saved
  image capability is still a bound advertisement, not proof of the provider's
  current capability or proof that the provider saw the pictures.
- An expired or discarded original capture may still be audited from a checked
  committed capsule at its original freeze time. This neither refreshes the
  capture nor supplies a current server baseline or permission to send again.
  Frozen audit does not recreate a missing context store.

## Storage and interruption

The private joint archive has a separate format, ownership marker and fixed
inventory. Each file has independent byte/hash bounds. Image normalization and
pixel quotas remain unchanged; the archive has at most eight records and
512 MiB of source files. Full capacity fails without evicting original evidence.
These are local data limits, not output-token limits or a larger model budget.

Files are created write-once and flushed; the manifest is published last.
Unknown files, linked directories, hardlinked sources, incomplete publications
and unknown publisher claims are preserved and rejected, not adopted, deleted
or reclaimed using PID/age guesses. Only a publisher's exact verified claim may
be released. Original source expiry before the commit leaves an incomplete
archive instead of silently refreshing the environment. A known write failure
or worker termination is not converted into success or automatic retransmission.

The integrity hashes detect mismatched or semantically inconsistent local
artifacts; they are not external signatures against a local actor who can
replace the whole store. File flushing plus commit-last ordering also does not
claim universal filesystem/power-loss durability or native-game crash recovery.

## Authority and remaining work

The public receipt exposes only bounded identities and disclosure metadata,
not raw facts, pixels, prompts, paths, archive ownership or a transferable token.
Its state remains `frozen-not-sent`, with `maximumCalls=1`, and all of
`modelSent`, `sendingImplemented`, `serverBaselineVerified`,
`canAuthorizePlacement` and both transferable-consent flags are false.
Private archive reads must not be exposed as HTTP responses.

Production still needs a separately versioned joint SEND fingerprint, fresh
capability checks, consume-once consent/invocation and unknown-result handling,
exact-picture transport, compiled-patch provenance and player UI. Then a real
closed joint task must pass difference preview, fresh server BEFORE checks,
separate world-write confirmation, protected undo and saved-world audit in the
same installed candidate. Neither synthetic tests nor source commits certify
those unimplemented gates, architecture quality or the complete release plan.

Run the authored-pixel/block-fact tests with the workspace-isolated runner:

```sh
node scripts/studio-tests.mjs --test-concurrency=1 --only tests/bridge/reference-world-patch-capsule.test.mjs
```

They include a real test-worker termination at the original commit barrier,
storage failure, expiry, restart/discard, exact-source corruption and semantic
self-rehash attacks. No private model answers, screenshots or worlds are used.
