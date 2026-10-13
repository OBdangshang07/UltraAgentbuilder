# Bounded original Bridge health probe — 2026-10-13

The original Java CI job for the preceding source milestone completed 822 tests
with two failures and one conditional skip. An archive read failed in the
initial health exchange with an HTTP timeout. A capability test instead exceeded
its own two-second future-observation bound. That failed CI job is retained;
a local pass cannot replace it, and it has not been rerun or promoted to main.

The client used a two-second health deadline, also shorter than its five-second
connection deadline. The new health budget is a bounded ten seconds. Only the
read-only health/identity probe changes: ordinary transfers, cancel lanes,
authentication, bundle identity, epoch checks and application SEND rules do not.
This is not an automatic application retry or an indefinite wait.

The new tests hold the exact original live health response beyond two seconds.
They require that it can finish without another health request, an application
replay, a changed connection file or a replacement Bridge. A second test holds
the response beyond the new budget and requires an unknown result, zero
application requests, the retained original connection and no service restart.

The two failing semantic tests now have bounded fifteen-second observation
windows, rather than asserting success inside two/three seconds. All expected
routes, payload validation, corruption rejection and no-generation assertions
remain. The separate one-second cancellation tests are unchanged.

The independent before-fix test failed at the intended boundary: its original
health probe had already ended while the response was deliberately held for
2.5 seconds. Its frozen source and original XML remain retained. The fixed
complete BridgeClient test class then passed all 35 tests, with no failures,
errors or skips, using newly generated fixtures. Neither result overrules the
preceding commit's original failed CI. The complete successor gates are separate.

This identifies and tests a health-deadline boundary; it does not establish the
cause of every earlier generation failure. Synthetic connection checks do not
prove real-provider completion, installed-game behavior, architectural quality,
same-asset placement/save or release readiness. Those gates remain required.
