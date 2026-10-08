# Independent joint HTTP route regression

This is development-source coverage, not a stable release or player UI
acceptance. No production permission or dispatch behavior is changed here.

The older capsule regression assumed that every joint-looking POST returned
404. The independent HTTP protocol introduced a read-only task audit route:
POST to that exact route returns 405, even with the process opt-in disabled.
Legacy context aliases remain absent and return 404. Correct-method actions
and reads on a disabled joint lane return 409 without provider discovery,
model dispatch or invocation-directory creation.

The replacement assertion specifies the exact status for each route rather
than accepting multiple rejection codes. The additional free synthetic HTTP
test covers disclosure, review, freeze, image freezing, task/job reads, SEND,
original observation, preview/candidate download and their method boundaries.
It also verifies disabled capabilities, zero model discovery/transport calls,
and no invocation archive. All fixtures use synthetic source data and images.

Targeted checks do not certify the full regression, actual model completion,
world transactions, design quality, compatibility or binary release. Results
from the earlier failing run remain failures; this correction does not rewrite
or replace them. Full regression and this commit's own CI must be evaluated
separately. Unverified future Java client changes are not part of this patch.
