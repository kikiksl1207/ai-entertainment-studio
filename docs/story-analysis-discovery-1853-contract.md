# Owned Analysis Discovery (#1853 / #1855)

Bounded validated candidate, 2026-09-22; independent integration review pending.
Base `4cdf11236d530025e001cf32debfda519eeb62d4`, schema65 (not proof schema66);
branch `codex/luffy-1853-discovery-20260922`.
Reuses `E:/CodexMovedCache/worktrees/luffy-1853-lossless-packing-20260922`
in place with its physical dependencies. No move/delete/install; only its own
client was regenerated to schema65 in the granted validation slot.
Packing770 remains pushed; proof `aa6a4f8` source/client66/DB/evidence untouched.

## Reader Contract for the Writer UI

The existing owned-work catalog is unchanged. After selecting `workId`:

1. GET `/api/v1/me/creator-studio/stories/:workId/manuscripts`
   returns `{ workId, items, hasMore, nextCursor }`.
   Each item has the existing intake manuscript keys:
   `id`, `workId`, `version`, `locale`, `contentHash`, `createdAt`.
2. GET `/api/v1/me/creator-studio/manuscripts/:manuscriptId/analyses`
   returns `{ manuscriptVersionId, items, hasMore, nextCursor }`.
   Each item contains `id`, `manuscriptVersionId`, `analysisVersion`, `status`,
   `kind`, `phase`, `sourceLocale`, `sourceContentHash`, `semanticCompleted`,
   `progress`, `approval`, `memoryApproved`, `errorCode`, `createdAt`,
   `startedAt`, `completedAt`.
3. Use an item's `id` with existing GET
   `/api/v1/me/creator-studio/analyses/:analysisId` for detail/evidence and its
   existing separate evidence pagination. Discovery does not replace that page
   cursor or declare unseen evidence reviewed.

Both new routes require real owner JWT and emit `Cache-Control: private, no-store`.
Optional UUID `cursor`, integer `limit` default12, minimum1, maximum30.
Newest immutable `version` / `analysisVersion` first; subsequent pages use a
strict lower-version keyset. `nextCursor` is the last returned item ID only when
`hasMore` is true, otherwise null. Do not silently display only the first page.

Work, manuscript owner, job actor and cursor are checked in a single bounded
repeatable-read snapshot. A job with null actor is discoverable only when its
pipeline is `structural_legacy` and the work/manuscript are currently owned.
An unauthorized parent returns404; unknown or out-of-scope cursor returns400
`ANALYSIS_DISCOVERY_CURSOR_INVALID`, without identifying another owner's row.

Jobs preserve pipeline `kind` and exact source locale (including legacy null).
`semanticCompleted` is true only for completed `semantic_extraction_v1` jobs;
`progress.coverageComplete` additionally requires completed/total paragraph
equality, matching existing detail semantics. Every item has
`approval: not_approved` and `memoryApproved: false`. Structural completion is
not semantic completion; neither completion state implies author approval.

Only scalar metadata is selected. No manuscript `structuredBody`, job `result`,
evidence, config pins, source digest, lease, actor identity, idempotency key or
provider payload is loaded for discovery. Counts/progress are existing stored
metrics, not a new manuscript scan. Unknown database failures become the safe
`ANALYSIS_DISCOVERY_UNAVAILABLE` response, not raw Prisma errors.

## Existing Reservation Conflict

POST `/api/v1/me/creator-studio/manuscripts/:manuscriptId/analyses` retains its
existing behavior and code. An already-reserved owned version returns HTTP409:

```json
{
  "success": false,
  "error": {
    "code": "ANALYSIS_VERSION_ALREADY_RESERVED",
    "statusCode": 409,
    "details": { "analysisJobId": "<owned-existing-job-id>" }
  }
}
```

The standard filter adds its normal message/path/request metadata. The service
exception also retains legacy top-level `analysisJobId`; the HTTP contract is
`error.details.analysisJobId`. No global filter changes. Ownership/actor scope
is verified before the ID is exposed, even when semantic generation is disabled.
UI may navigate to the existing job, not imply that a failed/unknown job is
retryable with a new key. Same-key replay remains unchanged.

## Deliberate Boundaries

GETs do not invoke provider readiness, tokenization, reservation, enqueue,
dispatch or recovery. A failed paid-unknown run is still failed/unknown, with
unchanged reserved budget and no zero-cost claim. No failed-job retry, semantic
decision/approval, reader memory, schema, worker, provider, proof, economics or
continuation length/timing changes. Catalog and existing detail projections are
unchanged; this is discovery for UI resumption, not a new approval workflow.

## Validation Results

All commands passed on their first attempt, with no failure, repair or rerun:

| Check | Result |
| --- | --- |
| Own Prisma6.19.3 client65 generate / schema validate | Both exit0 |
| Fresh guarded discovery QA database | Precheck0; 65 migrations applied, 0 unfinished |
| New discovery unit + existing semantic projection | 2 suites / 30 PASS, 29.667s |
| Actual JWT/DTO/filter/PostgreSQL HTTP | 1 suite / 7 PASS, 29.032s |
| Whole-server `tsc --noEmit --incremental false` | Exit0, no diagnostics |

Total **3 suites / 37 PASS / 0 FAIL / 0 SKIP**. All child command sessions
finished; scoped Node/Prisma processes0 and other target DB client sessions0.
Dispatched analysis chunks0, continuation rows0, provider transport calls0.
The synthetic failed/unknown job fixture verifies unchanged reserved cost and
null actual cost; it does not represent actual paid generation. Heavy slot was
returned before documentation/commit. No proof66/PM/retained QA DB touched.

Logs retained at `E:/CodexMovedCache/qa/luffy-1853-discovery/`:
`01-generate-first`, `02-validate-first`, `03-db-precheck`, `04-db-create`,
`05-migrate-first`, `06-unit-projection-first`, `07-http-pg-first`,
`08-tsc-first`, `09-final-db-state`, `10-process-check` (all `.log`).

### Exercised Scope

- `story-analysis-discovery.spec.ts`: bounded queries and scalar selectors,
  same-snapshot owner/cursor/actor checks, metadata semantics, default/invalid
  DTO limits, safe database errors, real exception-filter409 projection.
- `story-analysis-discovery.http.postgres.spec.ts`: actual Nest controller,
  JwtService/JwtAuthGuard, DTO pipes, global routing/filter and PostgreSQL;
  anonymous/invalid/foreign JWT, 14-version/15-job pagination, legacy-null actor,
  failed semantic metadata, cross-parent cursors, unchanged catalog/detail,
  owned409 details, provider-disabled zero transport and no implicit job writes.
  It is a focused controller module, NOT full AppModule validation. Unrelated
  progress service is a test double. Source/identities/rate card are synthetic.
- Fresh gated database: `lumina_analysis_discovery_qa`, loopback only;
  `STORY_DISCOVERY_TEST_DATABASE_URL` must explicitly opt in. No DB created or
  accessed during source phase; created only after the exclusive grant and
  absent-database check. Fixtures append only; no reset/truncate or
  retained packing/proof database mutation.
- Validation ran sequentially on this schema65 base. Package/lock match packing
  baseline; no install was needed. No build, broad regression suite, worker run,
  real manuscript read or paid provider call. This is not complete #1855 UI or
  #1896 length/timing/usage runtime acceptance.
