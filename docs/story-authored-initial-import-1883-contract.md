# Authored Initial Import (#1883)

Status: private initial-import candidate, verified on 2026-09-22. Own physical
dependencies and Prisma client 65; fresh isolated QA migrations 65/65; focused
tests 181 PASS, zero skipped. No public release, real approval, paid operation,
provider request, or production database operation. The controller, service and
multipart interceptor are registered in `StoryProductionModule`. Publication
remains blocked pending the real review binding described below.

## Boundary

This is a generic initial materializer, not a Norse reader mode or another raw
manuscript converter. It consumes evidence from `manuscript_intake.py`'s verified
`lumina-offline-manuscript-v1` package and the existing complete manuscript
intake. The stored manuscript projection must match every ordered paragraph;
that match alone is NOT a claim of lossless raw source coverage.

Require explicit owner/work/manuscript/release binding and expected content,
release and compact-map checksums. Server recomputes those identities and the plan checksum, and
validates covered source spans, coverage, route topology, and locale. Package
provenance and submitted inventory-list identities have the narrower scope below. Caller-provided
`validationSummary.ready`, declarations, or type assertions are not evidence.
An initial import refuses any existing parts, active release, or reader state.
There is no replacement, guessed backfill, or silent rebase of existing readers.

## Representation

- One runtime decision container per authored part; no invented intermediate
  choices. Each source scene has its own stable `sourceSceneKey`.
- Every beat belongs to exactly one source scene. Packing never crosses source
  scene boundaries, trims text, normalizes line endings, or truncates overflow.
- Existing reader bound: at most 40 beats per part, 7500 UTF-16 units per beat.
  A longer source is rejected pending a separately reviewed pagination change.
- Scene count in coverage reports is distinct from runtime container count.
  Actual source observations must be reconciled, not copied from declarations.
- Source A/B/C map to ordinals 1/2/3 with their authored labels. A resolves only
  to the explicitly authored next part or source-backed ending intent; B/C remain
  `generation_required` with null authored targets. No forced convergence.
- Every container, including the last one, has null `endingType`. Completion
  occurs only when its explicit ending choice is selected after reading.
- Only the source locale is present. Missing translations, visuals, generation
  activation, price, rights, or author review remain explicit outstanding gates.

The new packing function is intentionally NOT a source validator. Its input is
already-classified narrative, and its output hashes address that narrative
projection. Raw source span proof remains a separate validation obligation.

The existing intake places some unheaded production fields in its analysis
paragraphs. Exact raw/stored paragraph agreement still includes them, but they
must not become readable beats. Before the first declared scene only, seven
exact background/cast/previous-choice field forms and one exact three-line
previous-choice/cast/time bullet group are classified into private provenance.
No work/title/part-number switch or broad prefix stripping is used. The current
source has 273 such segments (67,973 bytes) across 120 parts. Their original bytes
remain in the compact source and stored manuscript; provenance records both the
analysis-paragraph indices and the narrower narrative/private classification.
Unknown, near-match, multiline narrative-like fields and legitimate unmarked
introductory narration are rejected, not discarded or guessed into scene one.
Such narration needs an explicitly reviewed scene binding before import.

## Additive Fields

`StoryBeat.sourceSceneKey String?` and `StoryBeat.visualManifest Json?` are a
nullable pair. Old rows keep nulls and the existing scene-level visual behavior.
New imports set both on every beat. The manifest is bound to `sourceSceneKey`,
not to the enclosing decision container's key.

Canonical `scene.beats[]` gains an optional field:

```ts
visualContext?: {
  sourceSceneKey: string;
  assetReadiness: 'missing' | 'ready';
  manifest: StorySceneVisualManifestProjection;
}
```

The existing top-level scene manifest remains for backward compatibility.
The reader can later select the active beat's visual context during prev/next
navigation without changing choice or route identity rules. The current UI may
ignore the additive field; that is not completion of per-scene visual playback.

Initial import accepts no arbitrary asset URL, generated image, or fabricated
cast. All source scenes start with explicit missing assets and the existing
neutral public fallback. Prompts and production directives stay private. Future
ready assets require a separately validated approved reference; a public-looking
path alone is not proof of approval.

The append-only `StoryAuthoredImport` receipt records the exact binding,
plan checksum, counts, and private source-span provenance. Unique work and
idempotency binding enforce initial-only materialization; explicit relational
constraints prevent cross-owner/work/manuscript/release references. No prose,
private paths, credentials, or raw prompts appear in audit or response summaries.

## Bounded Transport

The validated private package is 72,527,472 bytes; its analysis projection is
11,466,327 bytes. Do not raise global request limits or upload the full package.
The compact source map is derived from that same package, not reparsed by a
second converter: exact part AND design bytes plus compact classification/span,
scene, choice, act, and inventory metadata. Only duplicated text/hash representations
are removed. The initial measured representation was 15,509,039 bytes and retains
all 9,417,907 part bytes, 4,118,373 design bytes, 213,444 part segments and 15,127
design segments. The final implemented envelope additionally pins the exact
original manifest text and a compact reconstruction of the primary manuscript:
15,573,738 bytes, SHA-256
`f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5`.
This leaves 1,203,478 bytes below the 16 MiB file cap, independently of the bounded
8 KiB metadata and the existing extra 16 KiB multipart request allowance.

Primary reconstruction uses each complete part with CRLF converted to LF and
only trailing line endings removed, plus exact assembly separators. Original
part bytes remain intact in the map. Read-only source inspection matched all 216
parts this way and found 2,546 assembly bytes. The server reconstructs and hashes
the whole primary document and rejects unknown assembly prose. A package hash is
a provenance pin, not substitute evidence for these independently computed raw
source, stored manuscript, and materialization hashes.

Identity scopes are deliberately separate in `identityEvidence`:

- `serverVerified`: compact byte SHA; reconstructed covered part/design bytes,
  original manifest bytes and whole primary-document SHA; ordered agreement with
  the independently stored manuscript. The private plan and persisted row hashes
  are computed separately. Coverage counts include only files whose bytes were
  actually received/reconstructed, not the entire inventory.
- `declared.packageSha256`: caller/source-tool-attested original package
  provenance only. The original 72 MB package serialization is not uploaded, so
  comparing `expectedPackageSha256` to its embedded value verifies no original
  package bytes. The receipt column is explicitly `declared_package_sha256`.
- `submittedInventory.listSha256`: identity of the submitted inventory list,
  not authenticity or existence of original files absent from the upload.
  `uncoveredEntryCount` and `originalFilesystemVerifiedByServer: false` make that
  boundary explicit. The receipt column is `submitted_inventory_sha256`.

The local preparation tool independently rehashes the original filesystem before
and after compaction. That is local converter evidence, not server-upload proof
of all original inventory files. Neither declared package provenance nor an
internally consistent inventory list grants approval, rights, or publish readiness.
There is no new secret, signature, or HMAC authority.

`POST /api/v1/me/creator-studio/stories/:workId/authored-imports` uses the existing
JWT and work-owner guards. Multipart has exactly one `.json` file `sourceMap`
(at most 16 MiB) and one JSON string field `metadata` (at most 8 KiB). The whole
request uses the existing 16 MiB + 16 KiB envelope, content-length, upload timeout,
single-active-intake admission and bounded actor throttling. No global parser
limit is raised. Unknown fields, duplicate JSON members, encoded/chunked bodies,
invalid UTF-8 and overflow fail closed. An oversized map is not truncated.

`metadata` fields:

```ts
{
  manuscriptVersionId: string; releaseId: string;
  expectedReleaseChecksum: string; expectedManuscriptHash: string;
  expectedPackageSha256: string; expectedSourceMapSha256: string;
  expectedRevision: number;
  endingKey: 'author_main' | 'author_sub'; endingEvidenceSegment: number;
  apply?: boolean; // Default is dry-run, never apply.
}
```

Apply additionally requires an 8-200 character `Idempotency-Key`. Ending intent
must cite a matching claim in the final A choice's source evidence. That intent
does not constitute reviewed approval. Dry-run returns safe counts/digests and
outstanding gates, not source text, paths, private prompts, or materialized rows.

Before accepting such a map, rehash each source part, enforce exact UTF-8 span
partition and classification, compare ordered narrative to the stored manuscript,
and verify choices/scene order/act boundaries against the pinned source manifest.
Unknown production syntax fails closed. Checksums express identity, not legal
approval. Final ending resolution must be explicitly reviewed, not inferred from
the offline package's unresolved source claims.

## Apply and Publication

First apply writes draft materialization atomically. It does not create
rights, consents, approvals, prices, capability configuration, entitlements,
wallet changes, assets, or public release activation. Draft parts copy the work's
existing numeric price without changing it or treating it as approved. Price
remains a product decision, with synthetic local QA prices clearly separate.

Lock the work and binding rows, recheck identity and emptiness, and commit rows,
receipt, and safe audit together. Same key plus identical binding/plan replays;
different key or changed payload conflicts. A failure leaves no partial parts.
The new-receipt publication path recomputes stored source/release bindings,
materialized counts and content hash, final ending and branch policy. It then
blocks with `AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED`, regardless of caller
`validationSummary.ready`. A scoped SQL trigger closes the concurrent/direct
work-publication bypass. Legacy work without a new receipt keeps its existing
behavior. The source draft uses up to three serialization/uniqueness retries,
2-second transaction admission and 30-second transaction timeout per attempt.

## Tracked Review Follow-Up

Remaining #1883 publication acceptance item: `AUTHORED_IMPORT_REVIEW_BINDING`.
This is an explicit next integration step, not an approval in this change.
Existing `StoryFinalSubmission.checksum` pins only manuscript content; its writer
review can be submitted without binding a release plan or the final A decision.

The smallest future extension should require all of these criteria:

1. The real authenticated work owner reviews the imported candidate and explicitly
   confirms receipt ID, plan/materialized checksums, source-scene mapping version,
   release/manuscript binding and final A ending intent. No pre-filled approval.
2. Existing final-review transition/submission atomically pins those values with
   expected review revision. A legacy manuscript-only submission does not qualify;
   changed bytes, bindings, plan or ending require renewed author confirmation.
3. The existing authorized publication transition rechecks that immutable review
   binding and all independent rights, pricing, capability and asset policy gates
   under the work lock before promoting candidate rows. Import itself grants none.

No code for this future approval extension is included. Until it is reviewed and
implemented, new receipt-backed candidates intentionally remain unpublishable.

### Shared Proof Proposal With #1896

This is a next-slice contract proposal only, with no runtime authority added here.
`StoryWriterReview.decisions` and `finalSummary` are mutable; the current
`StoryFinalSubmission` checksum covers only the manuscript. Neither is sufficient
as generic anchor or imported-plan approval. #1883 and #1896 should consume one
append-only author-final-review proof, not two unrelated approval mechanisms.

1. Create the private candidate release against the manuscript first, without
   requiring materialized UUIDs or already-published parts. Initial import then
   creates those private rows and the immutable receipt bound to that exact
   existing release ID/checksum. Do not rewrite the release snapshot afterward
   to splice in the newly allocated row IDs; that would break the receipt pin.
2. Prepare any immutable #1896 anchor proposal against the receipt's private
   materialized rows and source-scene identities. Owner review can inspect draft
   candidate references. A release reference must not require a published part
   at this preparation/review step, which would create a publication cycle.
3. Extend the real author-final-submission transaction with one immutable proof
   binding owner/work, review ID and expected revision, final-submission ID,
   manuscript ID/hash, release ID/checksum, receipt ID, source-map hash,
   plan/materialized checksums, source-scene/visual mapping version, final A intent,
   and the reviewed anchor proposal ID/version/checksum where present. The server
   independently recomputes each covered binding and records explicit reviewed
   scopes; declared original-package provenance is not an authority hash.
4. Both publication and anchor authorization reference that same proof ID. No
   anchor scope exists when the author did not actually review that anchor plan.
   Publication validates private candidate rows and the proof under the work
   lock, then promotes approved eligible rows atomically with the work release;
   it must not demand those rows were already public. Rights, pricing, assets,
   generation activation and other independent gates still apply separately.
5. Changed manuscript/release/row bytes, visual or anchor bindings, ownership or
   ending intent invalidate authority. Require a reviewed successor revision,
   never mutate a receipt/proof or silently retarget it. Such successor imports
   are outside this initial-only endpoint. Legacy manuscript-only submissions
   never qualify by inference; revocation denies consumers of the same proof.

Acceptance should include draft-reference review without premature publication,
one proof accepted by both consumers, unreviewed anchor scope denial, stale-plan
and concurrent-change rejection, and proof revocation. No fabricated author
approval, public fixture clone, or disabled SQL constraint is an acceptable test.

## Wiring and Verification Slot

Module wiring is included in this feature:

- `StoryAuthoredImportController` is registered in `StoryProductionModule.controllers`.
- `StoryAuthoredImportService` and `StoryAuthoredImportMultipartInterceptor` are
  registered as providers. The existing `StoryManuscriptOwnerGuard` and SAME
  `StoryManuscriptAdmission` instance are reused, with no parallel admission pool.
- Existing semantic/continuation provider and opt-in worker factories are unchanged.
  No environment defaults or worker activation settings are modified.
- No UI changes. The existing fallback URL is a legacy reference, not proof that
  an image exists. Missing canonical fallback/onerror and beat-visual consumption
  are Cloud follow-ups; `assetReadiness` remains `missing` here.

Executed with PM's exclusive heavy slot using own physical dependencies/client.
The new `lumina_norse_release_qa` database was identity-checked on the approved
disposable loopback port, initially had zero public tables, and received all 65
migrations. No existing book/activation/provider/OTT database was reset or used.
Source and connection configuration stays in process environment, not this repo.
The optional real-source fixtures use read-only external paths, no prose in Git.

## Verification Plan

Verification scope (synthetic fixtures except explicitly marked actual source):

- Boot the actual `AppModule` with the new schema/client against the dedicated
  disposable database, without a reduced test-only module. Assert the authored
  route is registered at its real `/api/v1` prefix and all opt-in workers/providers
  stay OFF with default configuration; no external provider/network calls.
- Exercise actual HTTP route auth and bounded multipart handling: unauthenticated
  and cross-owner requests fail before intake, an owned valid dry-run reaches the
  registered service without writes, invalid file/metadata and file/request
  overflow are rejected, and the existing SAME admission instance prevents
  overlapping manuscript/import uploads. Close app/server/DB handles afterward.
- Verify original and derived artifact checksums before/after; reconstruct all
  source spans and compare every ordered narrative, scene boundary, choice,
  act, and packed public-body digest without printing prose.
- Assert all scene identities survive packing and each beat's visual context
  changes appropriately; no production directives reach public text.
- Run dedicated real PostgreSQL constraints and service transactions for replay,
  changed payload, concurrent import, injected mid-write rollback, nonempty work,
  cross-owner/version references, and receipt immutability.
- Actual 216-part PostgreSQL import checks stored first-part, every act-transition
  and final-part body digests and A destinations. All 2,138 source scenes remain
  separately mapped to beats, and all B/C destinations stay null/generation-required.
  These are private graph/storage checks, NOT public reader A traversal. The real
  reader service rejects the draft with 404. No trigger/receipt was removed and
  no content was copied into a published work to bypass the review requirement.
- Exclude drafts, fixture, and unapproved releases from public discovery and
  deny paid non-entitled reads. Do not call live wallet/provider/publication.

## Verification Ledger

- Bounded preflight: `npm ci --ignore-scripts` installed 746 packages in 27 seconds;
  own Prisma 6.19.3 validation and generation passed. No dependency lock changes.
  First whole compile failed with five TS2345 diagnostics in the new controller
  test fixture (lines 24/42/48/50/51): missing `StoryUploadFile.encoding`. Added
  `encoding: '7bit'` to the fixture; rerun passed. This failure is not erased.
- Initial focused run: 152 PASS, one actual-source fixture SKIP before compaction.
  First actual-source run: 152 PASS / one FAIL, correctly rejecting unclassified
  pre-scene production fields. First narrow correction: 28 PASS / one FAIL on
  the explicit three-line bullet group. Both failed logs/JSON remain outside Git.
  Final source-policy run: 35/35 PASS, including six unknown/near-match/introduction
  rejection cases, seven explicit-field cases and the exact bullet group.
- Final focused unit/policy regression: 10 suites, 167/167 PASS, no skipped tests.
  Breakdown: existing release policy 65, production service 15, route identity 5;
  Imjin bridge policy 11 and service 7; new compact policy 35, packing 11, visual 4,
  import controller 7 and import service 7.
- The 18 Imjin bridge tests include read-only actual 75-part policy/materialization
  and 74A/75A service regression using a persistence double. They are not a fresh
  actual Imjin PostgreSQL publication run and are separate from Norse evidence.
- Dedicated real PostgreSQL: 7/7 PASS (65.115 seconds), including atomic writes,
  concurrent same-key replay, different-key refusal, cross-owner/nonempty refusal,
  injected mid-write rollback, paired visual constraints, receipt immutability,
  review-gap/direct-publication denial and mutation detection. Actual 216-part
  apply/replay/storage/graph/denial case took 45.565 seconds end-to-end.
- Actual full AppModule with production HTTP prefix/pipes/filter: 7/7 PASS
  (24.763 seconds), covering default-OFF providers/workers, health, JWT/ownership,
  multipart dry-run, invalid input, request bound, shared admission and shutdown.
  This smoke uses small private synthetic files, not an actual 15.6 MB HTTP upload.
- Final whole `tsc --noEmit --incremental false`: PASS. Changed TypeScript lint:
  zero errors, one existing unused `isPlainRecord` warning in production service.
  Total distinct focused tests: **181 PASS, zero FAIL, zero SKIP**.
- A first DB identity guard stopped before migration because textual `inet`
  formatting included its netmask. The guard was corrected to `host(inet_server_addr())`;
  the exact dedicated DB/user/address/port matched. No guard was removed or broadened.
- End state: 65 completed migrations, zero unfinished; five private QA receipts,
  including one actual-source receipt with 216 parts / 11 acts / 2,138 source scenes
  and beats / 648 choices. Zero published receipt works, zero reader progress,
  zero other active DB connections. Synthetic mutation/negative-test evidence is
  retained; this QA database is not a clean publication candidate database.
- Full QA execution interval: 2026-09-22 07:53:57 to 08:09:58 KST (16m01s), separate
  from the earlier 4m16s preflight. All owned runtime processes and sessions closed;
  heavy slot returned before documentation/commit/push.

Norse reader UI and live/public A traversal remain blocked by the real review
binding gap; the shortest follow-up acceptance criteria are above. Existing Imjin
reader/browser evidence is not substituted for this missing Norse acceptance.

## Source Inspection Evidence

Read-only size/SHA verification on 2026-09-22 matched all three entries in the
existing derived checksums file and the handoff's original manifest/ZIP pins.
The subsequent compact preparation rehashed every original inventory file before
and after, and the six core original/derived artifact identities were unchanged.
Inventory counts **897 files**: the source checksum CSV contains **896 records**,
and the CSV itself is the one additional inventory file. These counts describe
local converter evidence, not proof that the server received every original file.

- Package SHA-256: `a447f290421e38da13182e065db810207cc1d0dd5ebd42fcae923c54fbf8336b`.
- Analysis SHA-256: `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8`.
- Report SHA-256: `4db124d38f5badf09439ef50c465d59064c9cd1ce5fbc3cd2074e64406136b39`.
- Original manifest SHA-256: `c31d44f6d7357c0227c05099bdc864cb0266606d5bcf346689ecf811f885fbf0`.
- Original ZIP SHA-256: `bd96febc4157e046c44da44f98c6a831688a74830cfe72d98e656a2d0bbd6513`.

No source manuscript text or local source path is included in this document.
