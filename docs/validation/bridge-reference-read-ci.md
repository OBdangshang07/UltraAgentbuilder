# Bounded reference-read test waits

The original CI run `40052097825`, attempt 1, for source
`e3e1d2854501a9793f67de73b827e0d018aaaefc` passed the complete Node job but
failed Java: 970 tests, two failures and one optional compatibility skip. The
two failures were `CompletableFuture.get` timeouts in the successful original
history read and exact-image restore tests. Compilation succeeded. Preserve
that failed result; a later run does not change its outcome.

Those two tests waited eight seconds for complete, multi-request reads. The
bounded production health probe alone permits ten seconds. They now wait at
most thirty seconds, without changing production deadlines, model budgets,
retry rules, source-byte verification or one-second cancellation assertions.

A separate synthetic regression deliberately holds the original history GET
beyond the former eight-second wait. It checks that the same future remains
pending, cancellation bypasses the reference lane, and release completes with
the exact original image bytes: one history GET, two image GETs and no SEND.
The test does not retry a failed task or substitute a different history.

This fixes a demonstrable test/production wait mismatch. It does not establish
the cause of the original hosted-runner delay or a native Minecraft crash.
Neither passing synthetic tests nor Java compilation certifies installed
gameplay, physical image understanding, architectural quality or a release.
