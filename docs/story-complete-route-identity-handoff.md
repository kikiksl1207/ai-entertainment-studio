# Complete Story Route Identity (#1897)

## Contract

`story-route-v1` hashes the complete ordered route, not titles, labels or a recent
suffix. The root pins work/release/checksum/manuscript/entry scene. Each canonical
step adds source scene, canonical choice ID, target scene and ending key. A
generated step adds only an approved reusable source ID and its choice key.
Reader IDs, progress IDs, private generated IDs, node UUIDs, timestamps and text
never enter the shared identity. Sharing still requires all existing legal,
consent, locale/region, moderation and quality gates. Custom input remains off.

Private append-only `StoryProgressRouteNode` rows retain the parent chain. Progress
and checkpoints store `routeNodeId`; continuations pin `sourceRouteNodeId` and
`sourceRouteHash`. Composite foreign keys enforce progress/work/release ownership;
SQL rejects node mutation/deletion and continuation pin mutation/mismatch.
The rolling SHA-256 value is constant-size regardless of history length.
`narrativeStep` contains only allowlisted private scene/choice references, not
text. It restores the last 24 references at an exact act prefix after a longer
suffix has displaced them from progress. It is excluded from all shared hashes.

The shared registry's existing `semanticPathFingerprint` now stores the complete
route hash. The reusable context also includes the versioned route identity.
Old cache keys do not match. No old result is promoted or migrated into approval.
Unknown legacy history is not reconstructed from the 24-entry `pathSummary`.
Unknown/private route identity stays null, excluding sharing only. Legal personal
generation and reading remain available.

## Atomic Updates

- Start: personal progress and a complete root are created in one transaction.
- Canonical choice: one node, choice event and progress revision commit together;
  a losing concurrent choice rolls them all back.
- Enqueue: the source pointer/hash are pinned before allowance reservation. The
  context assembler reads them from the continuation and rejects a changed route
  before provider execution. No executor/provider request interface is changed.
- Settlement and shared hit: append the chosen canonical/shared/private step and
  advance the personal pointer in the same transaction. Failed settlement does
  not append; idempotent replay does not duplicate nodes.
- Checkpoint: persist the exact pointer alongside the existing revision/scene.
  Continue/resume reads the existing pointer. The existing checkpoint confirmation
  API does not rewind progress; this slice does not invent a rewind endpoint.
- Full reset: create a fresh root for the current approved release pin, retaining
  old private nodes. Same release/entry yields the same hash; a new release does not.
- Act reset: restore only an exact recorded entry prefix, including its bounded
  narrative references. Missing/ambiguous prefixes remain unknown for sharing.
  Reset replay returns the original receipt without appending another root.

## Bounds and Memory

The 12-step semantic context and 24-entry reader summary remain bounded and
separate. This is not reader-derived long-term memory and does not complete
#1854. No source text is truncated or relabeled as proven narrative continuity.

Dependency/reset walks are capped at 16,384 private nodes; shared-result ancestry
is capped at 2,048 results. Missing roots, overflow or invalid ancestry fails
closed for sharing/prefix restoration, never by hashing a truncated suffix.
The rolling hash itself has no such truncation. Shared source rows are locked
within the caller transaction and approval/ancestor withdrawal is rechecked.

## Verification

Final bounded regression (2026-09-22): 12 suites, 159 tests passed with no skips,
including 35 real-PostgreSQL cases. Nine route cases cover early divergence after
25 identical choices, exact cross-reader hits, 27-step act reset suffixes,
checkpoint/resume/replay, release changes, generated shared/private routes,
ancestor withdrawal, stale worker pins, concurrent choice rollback and DB guards.
The activation corrective suite also passed its 216-result approval lineage.
Before the final act-reset reference restoration, the wider story-production
run passed 38 suites / 476 tests with one existing skip. That wider run was not
repeated after the final change; all directly affected suites were rerun above.

Own physical dependencies were used for Prisma generation. Fresh 60 migrations
applied successfully to the verified disposable route QA database. TypeScript
noEmit, touched-file ESLint and whitespace checks passed. The final DB contains
only migration seeds and synthetic fixtures: 32 story works, 498 route nodes and
five intentionally queued/processing test continuations, with no worker running.
There are zero unfinished migrations and zero disabled user triggers. Restored
legacy-source preservation is reserved for independent QR, not claimed here.

Tests use only the dedicated loopback synthetic route QA database and offline
provider doubles. No live provider, payment, publication, deployment or push.
Frozen #1895 checkout, dependencies and activation QA database remain untouched.
Public operation still requires independent review and explicit business/legal
approval; passing route identity tests alone is not launch authorization.
