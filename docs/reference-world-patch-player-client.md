# Joint player client lifecycle (development only)

The Java client has an independent reference-image/world-patch preparation,
freeze, original-image freeze, single SEND and original-status reader. It uses
the joint protocol, not legacy text-patch consent or a reference-building task.
It remains an internal integration API: normal player UI and the full shared
Lite/Pro/Max/Ultra design workflow are not completed by this milestone.
Default packaged startup has not been enabled for joint SEND.

## Durable originals

Joint SEND references use `reference-world-patch-references` and
`SavedReferenceWorldPatchReference`. Legacy references retain
`world-patch-references` and `SavedWorldPatchReference`. They share only bounded
file IO; each has its own protocol validator. Neither may adopt the other's
format, consent, images, runtime or baseline.

A claim is written and flushed before image freezing or model SEND. An
ID-keyed `CREATE_NEW` pending file prevents two separate stores from both
publishing the same dispatch claim. No original is replaced. Later attempts,
including after restart or a lost SEND reply, only GET the exact original job.
Missing server history is not permission to send again.

Both lanes keep their existing eight-record quota. Complete unpublished,
partial, corrupt or unknown files are preserved, not deleted or adopted.
Existing verified originals remain queryable; an unpublished pending file
blocks creation of new claims in that lane. Historical legacy UUID pending
names remain recognized. A quota is an explicit stop, not silent eviction.

## Checked dispatch and recovery

The joint exchange has fatal UTF-8 decoding, duplicate-key rejection, exact
receipt verification and byte limits. Preparation verifies the caller's
independently retained canonical image manifest and advertised capability.
The freeze requires its own joint confirmation. Original image freeze checks
the capsule and exact ordered pixel hashes and has zero model-call authority.

SEND requires the same original integrated-server Capture, checked before
image freezing and again before the sole model POST. Closing or superseding
the page before exchange, original-world changes, expiry, publication failure,
changed runtime or wrong image hashes prevent SEND. A local claim is retained
even when one of those checks fails. Once POST is attempted, closing the panel
does not authorize a resend or invalidate a returned original receipt.

Read-only history/status needs no new capture or model-capability discovery.
A separate explicit original-observation action is available only when the
checked original status is `unknown` and permits it. There is no joint
`recheck-response` endpoint, implicit repair, fallback model or legacy SEND.
An unknown result remains potentially spent; no refund or success is inferred.

These APIs and synthetic tests are not actual model, player UI, aesthetic,
whole-building circulation, Iris, saved-world transaction or release evidence.
The joint lane still has a one-call development contract and cannot be called
the completed Ultra pipeline. Candidate projection remains original-coordinate;
world writes still require separate current-before checks and explicit in-game
confirmation through the shared checked transaction path.
