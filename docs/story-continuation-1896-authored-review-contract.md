# Common Author Final-Review Proof (#1883 / #1896)

Approved INITIAL NEW-SUBMISSION contract, 2026-09-22. Bounded proof candidate
ready for independent review, not complete #1896. Stage A: 107 unit tests and
whole type/schema checks passed. Stage B: 97 tests, migration66 and first/final
whole type checks passed after two preserved initial failures. See the
[exact Stage B record](story-continuation-1896-stage-b-proof.md).
Base `d7627ca` includes `edebaee` / Kaido `532aba2`. Own physical E dependencies,
client66 and fresh own QA evidence are retained; heavy slot has been returned.
No paid calls or production approval. Length/budget/usage/timing runtime remains
unwired; actual feature JWT/DTO/filter HTTP acceptance is still pending.

## One Contract and Creation Order

**One append-only common proof, created by the existing author final-confirmation
transaction and linked to StoryFinalSubmission.** Both consumers use its proof ID.

1. Paste creates immutable manuscript version/content hash/source locale.
2. Create the private candidate release ID/checksum before materialization.
   No future canonical UUID or already-public part is required.
3. #1883 writes private rows and immutable `StoryAuthoredImport`. Actual pins
   are `sourceMapSha256`, `planChecksum`, `materializedChecksum`,
   manuscript/release bindings and source provenance. There is no persisted
   import `planId`; do not invent one.
4. Server prepares an owner-only proposal from the receipt/private rows.
   `proposalId = proposalHash` is the content-addressed versioned snapshot.
   Its optional anchor plan contains source-scene identities, runtime references,
   narrative hashes, locale, proposed 80..120% bounds and ending eligibility.
   Automatic proposals, not hundreds of manual reference fields.
5. One owner confirmation submits that proposal hash, expected review revision
   and explicit scopes. Server recomputes bindings and atomically writes proof,
   submission/review state and safe audit. A proposal never equals approval.
6. Authorized publication verifies proof and independent gates under the work
   lock, then promotes approved draft rows/release atomically. Continuation uses
   only an explicitly reviewed anchor scope on that SAME proof.

Mapping uses exact `sourceSceneKey` identity in receipt provenance and beat rows,
then their container/part FKs; require complete membership and matching packing
hashes/counts. No title/position/previous-AI-text matching. A per-part reference
covers the entire reviewed narrative, not an arbitrary single source scene.

The snapshot covers owner/work/review revision, manuscript ID/hash, release
ID/checksum, receipt ID/source-map hash, plan/materialized checksums, source-scene
mapping version, final A intent and optional anchor version/hash. Visual identity
is covered by the content digest, not a fictional separate visual-version field.
Declared package provenance/inventory are not authority hashes. No raw manuscript,
private path or production prompt in the proof projection/audit.

## Minimal Schema

Two additive tables, no separate anchor approval or persisted proposal table.
The content-addressed proposal is recomputed before confirmation; the immutable
proof archives its bounded reference/hash/metric snapshot once. Migration
`20260923010000_story_author_final_review_proof` was applied only in fresh own
QA during Stage B, not production. A 1:1 child row supplies typed scope FKs, insert-time binding checks
and DB-enforced append-only identity that mutable review JSON cannot provide.
It is written only inside the existing submitReview flow, not a second approval.

| Record | Fields |
| --- | --- |
| `StoryAuthorFinalReviewProof` | `id`, `finalSubmissionId`, `reviewId`, `reviewRevision`, `ownerUserId`, `workId`, `manuscriptVersionId`, `releaseId`, `authoredImportId`, `contractVersion`, `proposalHash`, `contentChecksum`, `anchorScope`, `bindingSnapshot`, `proofHash`, `createdAt` |
| `StoryAuthorFinalReviewRevocation` | `proofId` (unique FK), `actorUserId`, constrained `reasonCode`, `createdAt` |

Scopes are `authored_publication` and `continuation_anchor`. Anchor scope requires
its matching proposal and explicit confirmation, including an explicitly allowed
`minGeneratedSegments: 1` if selected. No approval inferred from the proposed band.

Unique final submission, review, release and import receipt: one initial proof.
Idempotency remains bound to the existing submission key after actor/binding
checks. Revoked or missing-scope proof has no fallback. Composite
FKs/parent unique keys and binding checks enforce same owner/work/manuscript/
release/receipt and submission/review identity. CHECK versions/hashes/scopes;
forbid proof/revocation UPDATE and DELETE.

Keep the existing manuscript-only submission checksum and reviewId uniqueness.
Confirmation creates BOTH the new submission and its proof in one transaction.
An existing manuscript-only submission is never upgraded or reused for a new
proof. Submitted reviews remain terminal. Supersession/reconfirmation/edition
management is explicitly unsupported until a separate additive workflow exists.
Do not fabricate a new analysis, reopen terminal reviews or overwrite any proof.

## Writes and Actors

- Proposal/read: JWT current work owner with matching review/manuscript/receipt.
  Private draft references are reviewable, never thereby publicly readable.
- Confirm: actual authenticated owning author, not an admin impersonating author.
  Expected revision + exact proposal + explicit scopes + continuity decisions.
  Work-first locking, binding/content recheck, new submission plus new proof,
  safe audit and review CAS in one transaction.
- Publish: existing permissioned publication actor. The unrevoked initial publication
  proof plus independent rights/price/capability/assets/continuity gates. Import
  does not grant any of these permissions.
- Revoke: current owner in this initial implementation,
  never a reader. Append revocation/audit under the work lock. Both consumers
  deny that proof. Withdrawal of an already public release still follows the
  existing publication workflow; do not claim automatic reader-data removal.

## Replay Fix Before Authority

Baseline `submitReview` returned global-key or existing-for-review receipts BEFORE
owner lookup. The source patch moves ownership checks ahead of both. New service
unit checks passed in Stage A; lifecycle/proof PG checks passed in Stage B.
Actual author-route JWT/DTO/filter HTTP checks remain pending.

1. Resolve the requested review AND its current owning work for the actor before
   any replay projection; recheck under write locks.
2. A global legacy-key hit must belong to this exact owned review/manuscript.
   Foreign-owner/different-review collision returns non-disclosing conflict or
   not-found, never somebody else's receipt.
3. A valid owned legacy replay returns only historical manuscript submission,
   explicitly without common proof/scope. Unverifiable legacy binding fails
   closed. No guessed approval or automatic upgrade.
4. New-proof requests must match proposal/revision/scopes on replay. Existing
   legacy submission is an explicit unsupported-upgrade response, not early
   success and not a new confirmation with a different key.
5. Same owner/key + same binding replays one proof; changed body conflicts.
   Concurrent different keys cannot create two proofs for one review revision.
   Revoked replay is historical, not restored authority. No supersession exists.
6. Fix the analogous publication global-key replay to bind its authorized actor,
   work/release and request identity before returning an earlier transition.

## Draft Promotion Integrity

Receipt `materializedChecksum` includes part/scene `status: draft`, so publication
changes that snapshot. Preserve the receipt, verify its exact draft hash before
first promotion, and additionally pin versioned `contentChecksum`
excluding ONLY specified lifecycle status fields. It still covers IDs/order/
text/choices/price/visual identity. Later consumers validate this content hash
and allowed lifecycle state; never silently rewrite all current fields as draft.

Replace the unconditional SQL publication denial with proof-bound validation,
not a removed/disabled trigger or mere proof-row-exists check. One deterministic
bounded DB content-checksum projection should be used by proof creation and the
SQL guard to deny changed rows. Application verification additionally checks the
receipt draft hash, mapping/counts/final A intent and independent gates. Lock
covered rows through atomic draft promotion. No immutable release checksum edit.

## Validation and Remaining Work

### P2 Guard: PostgreSQL Counterexamples Passed

QR1's source-only finding identified a real gap in the then-unexecuted WIP. The
Stage A migration checked the materialized content digest when the work was
published, but did not guard later writes to canonical parts/scenes/beats/
choices. Existing migrations protect generated/reusable results and import
receipts, not these canonical content rows. The reader projects live beat rows;
a later continuation checksum check is NOT reader protection.

The corrected migration now has row guards on canonical parts/scenes/beats/
choices. Once any proof covers a work, insert/delete and content/mapping/member
changes are denied on BOTH old and new work scopes, even after revocation.
Only lifecycle status and publication/update timestamp fields can change in place;
created_at remains immutable, including on beats/choices.
No-op content writes are allowed. This does not add an author edition workflow.

Application paths lock work first. Direct SQL can already hold a target child
row before a BEFORE ROW trigger, so the guard acquires sorted work and ancestor
locks with NOWAIT, failing fast instead of waiting in inverse order. It rechecks
parent scope after locking. Proof insertion writes the work's updated_at in the
same transaction as an MVCC barrier: a repeatable-read writer predating approval
must fail serialization rather than miss the newly committed proof. This is a
controlled timestamp write, not a receipt/content checksum rewrite.

Canonical table TRUNCATE is explicitly unsupported, even without a visible
proof: it has no row scope and a stale snapshot must not bypass protection.
Unapproved legacy row-scoped editing remains supported. This policy does not
affect unrelated tables. It must not be described as support for #1901 serial
additions or republication of a changed edition.

Executed PostgreSQL counterexamples cover positive publication followed
by direct content/mapping/member writes, both reparent directions, insert/delete,
unchanged content digest, status/suspension/resumption, revocation, NOWAIT lock
contention and a stale repeatable-read snapshot: 47 PASS. A separate full
default-OFF AppModule health HTTP test passed. That is bootstrap only, not actual
author-route authentication/DTO/filter acceptance. Independent review remains.
See the [Stage B record](story-continuation-1896-stage-b-proof.md).

### Staged Validation

Stage A completed: own physical E dependencies, generated client66, schema
validation, first whole-server type check, and four helper/proof boundary suites:
107 PASS / 0 FAIL / 0 SKIP. No corrective rerun, donor/client change or migration
application. Heavy slot returned. See the [exact validation record](story-continuation-1896-stage-a-validation.md).
Stage B completed in fresh separately guarded `lumina_author_length_qa` only:
66 completed migrations, one retained rolled-back attempt, zero unfinished;
seven suites / 97 PASS / 0 FAIL / 0 SKIP. Proof, P2 and actual216 tests passed;
actual Norse QA publication1 used synthetic owner confirmation, NOT real author
consent or production approval. Original source hashes were unchanged. No
retained Imjin/Norse evidence DB was modified. The initial migration SQL syntax
failure and submission DB-timestamp product failure are recorded separately.
Stage C remains continuation length/budget/usage/timing runtime and its checks;
helper tests and proof-stage passes do not establish that behavior.

### Legacy Imjin Boundary

Accepted actual Imjin import `b51` used an older pathway and may have neither a
`StoryAuthoredImport` receipt nor beat `sourceSceneKey` mappings. Its prior
read/publication acceptance is NOT receipt-backed proof or v2-anchor acceptance.
This work does not inspect, migrate or upgrade that retained database. No source
key/receipt may be invented from titles, row order, text similarity or existing
public status, and no historical submission may be upgraded into author approval.

For a work without the new receipt, the added publication guard returns to the
existing legacy publication checks. Canonical reader behavior is not changed by
the proof resolver; existing access/entitlement checks remain in force. Neither
legacy readability nor that publication compatibility authorizes v2 generation.
The v2 resolver rejects absent proof, absent anchor scope, missing receipt binding
or revocation before loading narrative/tokenizing. Exact source mapping is also
required when preparing a new proof. Unknown dispatched legacy jobs still need
their terminal recovery path, not a generation retry or a fabricated anchor.

`story-author-review-legacy-boundary.spec.ts` adds synthetic resolver/guard/mapping
regressions for these boundaries, passed within the Stage A four-suite run.
They are NOT an actual Imjin database test or full enqueue/reservation integration
coverage. Stage B's focused lifecycle/import regression is not a broad reader
regression run. Full v2 enqueue/worker wiring is still outstanding below.

Actual Imjin v2 eligibility requires follow-up verified generic import/mapping
preparation and the same explicit owner final confirmation on an eligible NEW
submission. Whether a new private work/candidate is necessary must be resolved
in that follow-up: this initial-only import/proof contract cannot overwrite an
existing populated work, immutable receipt, release or terminal review. In-place
historical migration, automatic approval and an edition/supersession workflow are
out of scope. Norse receipt-backed acceptance cannot stand in for this proof.

## Integration and Independent Review

`StoryProductionModule` registers `StoryAuthorFinalReviewService`; the existing
`StoryLifecycleService.submitReview` delegates explicit `authoredReview` bodies
to the same final-submission transaction. No second approval workflow exists.
No new activation flag enables a paid continuation path.

- Owner JWT POST `/api/v1/me/creator-studio/reviews/:reviewId/authored-proposal`:
  `releaseId`, `expectedRevision`, optional `includeContinuationAnchor` (false),
  optional `minGeneratedSegments` (1, explicit scope confirmation still required).
  Returns `proposalId`/`proposalHash`, `approval: proposed`, bounded snapshot.
- Existing owner JWT POST `/api/v1/me/creator-studio/reviews/:reviewId/submit`:
  `Idempotency-Key` plus optional `authoredReview` containing proposal inputs,
  `proposalHash` and `reviewedScopes`. New proof response adds `proofId`,
  `proofHash`, `proofStatus`; legacy replay is historical, not v2 approval.
- Owner JWT POST `/api/v1/me/creator-studio/author-review-proofs/:proofId/revoke`:
  append-only revocation. Existing admin publication transition stays separately
  permissioned and independently gated.

Independent QA should exercise these actual JWT/DTO/filter routes, foreign-owner
and stale/hash/scope/key failures, confirm replay and revoked publication denial.
Health200 cannot stand in for those checks. No actual author UI acceptance yet.

Length/timing helpers and resolver are preparatory only. Proof service/controller,
publication and migration are wired; enqueue/job pins, output admission/length/
ending validation, shared/direct settlement and timing coordinator remain unwired.
No completion or paid
readiness claim and no release budget increase. Runtime integration MUST capture
valid received numeric usage before adapter rejection
and retain result usage through executor length/moderation rejection, settling
measured cost at pinned rates. Missing/invalid usage or failed persistence stays
null/unknown and durably fenced, never zero cost or automatic regeneration.
