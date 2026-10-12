# Installed full-save verification — 2026-10-12

This is a bounded alpha verification record, not a binary release or a claim
that arbitrary AI building requests will succeed. Private test tooling, model
records, account data, images and worlds are not included in this repository.

## Exact tested production candidate

- Source: `db28d87454a5ed498660971eb8576a30813d5078`.
- Version: `0.4.10-alpha`.
- Production JAR SHA-256:
  `6f7af1acd46f95acf51b0790675c2bc112aa4d70c0520dc5e12c908f7ba5f4cd`.
- Source inventory: 897 files; bundled companion: 233 declared members.
- Original source CI: run `38260429995`, attempt 1, both original jobs passed.
  No rerun or CI for a later documentation commit substitutes for this evidence.
- Closed local regression: Node 2225 tests / 2223 passed / 2 conditional skips;
  Java 818 tests / 817 passed / 1 conditional skip; no failures or errors.

The production JAR remained unchanged. A separate, restricted private test
auxiliary called the normal UI handlers in a new visible isolated Minecraft
1.20.1 instance. It did not shadow production classes, inject an adapter, use
Computer Use, or operate on a player's existing world.

## Complete original placement → save → normal exit

Passed using one new synthetic-provider task:

- One normal SEND; repeated SEND ignored; closing the panel did not stop the
  original generation pipeline.
- Production builtin companion extraction, owned Bridge process and production
  Codex stdio adapter were checked against the unchanged installed package.
- 17 simulated provider responses, **zero actual building-model calls**.
- Actual occupied candidate: 64 × 224 × 64 blocks.
- All 274,961 original operations and all 34 transport parts were downloaded
  and checked; no reduced or substitute candidate was adopted.
- One separate final in-game transaction confirmation, one original complete
  apply journal, no undo or later-edit step in this scenario.
- Normal save acknowledgement, then normal closure of the original JVM and
  builtin Bridge. Their original exit records and process absence were checked.
- An independent reader inspected the closed MCA files and compared all
  **1,523,200 cells** in the original context against the original BEFORE state
  plus the complete original native write set. Every cell matched; the 274,961
  changed cells matched the complete apply journal.

This proves complete placement durability for this exact bounded synthetic
scenario. It is stronger than a progress counter, save acknowledgement, or an
audit of a world that had already been undone. It does not prove quality or
real-provider unattended completion.

## Cancellation and rollback

Passed on 2026-10-13 (SGT) in a separate new synthetic task and isolated world:

- The same exact production candidate again produced the full original
  274,961-operation / 34-part candidate without a substitute or clipped scope.
- After the separate final confirmation, explicit cancellation stopped at a
  known confirmed prefix of 512 operations, not an ambiguous in-flight batch.
- The original apply journal closed as `CANCELLED`. The independent original
  inverse journal evaluated and restored all 512 operations, with zero
  preserved/conflicting operations in this no-later-edit scenario.
- The original JVM and builtin Bridge saved and exited normally.
- The independent closed-MCA reader compared all 1,523,200 original context
  cells to the captured BEFORE state: zero changed cells and no residual writes.
- This task used 17 additional simulated provider responses and zero actual
  building-model calls. It did not replay or reuse the full-save world.

The two original worlds therefore provide different evidence: the first proves
the complete building was saved; the second proves a known partial prefix was
cancelled and durably restored. A rollback proof is not a full-building save
proof. Later-player-edit protection, arbitrary crash recovery and real-provider
completion are not certified by this cancellation scenario.

## Remaining acceptance work

- Real GPT-6.1 Sol / Max generation through the normal installed UI, with the
  same final native asset applied and independently verified in its closed save.
- Difficult-building design quality and same-model comparisons; actual visual
  evidence is not an aesthetic score or a guarantee of working circulation.
- Reference-image understanding and coordinated environment-aware revision.
- Physical Chinese IME, Iris/shader compatibility, p95/p99 performance and
  installation/upgrade/reuse/rollback gates.
- Conditional DSH SDK and physical IMBlocker integrations remain unverified.
- Independent review and release gates. No formal player installation was
  overwritten and no production binary release is certified by this record.

Unknown model or journal outcomes remain unknown: no automatic replay, source
hot-edit, substitute asset or repeated write is authorized by this document.
