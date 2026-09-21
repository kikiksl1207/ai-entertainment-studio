# Semantic Manuscript Extraction (#1853)

Status: focused dependency/client/PG validation passed; complete actual-source
planner metrics are pending the next serialized CPU slot. No paid requests or real
manuscripts sent to a provider. Do not treat this as live model quality/readiness.

## Scope and Meaning

The existing analyze endpoint now queues an immutable-version semantic extraction
job instead of synchronously reporting tag parsing as completed AI analysis.
States are queued/running/completed/failed; phase and paragraph/chunk counters are
safe owner projections. A completed run means all planned source spans were
processed, not that observations are true, the manuscript is approved/published,
or author/reader memory is approved. It is not fine-tuning.

Candidates contain kind, bounded plain-text title (120 UTF-16 units), observation
(1200 units), optional style category, and 1-4 validated citations. The observation
is explicitly `model_inference`, not the exact quote or a verified factual claim.
The validator rejects missing/forged citations, substituted version/hash, unknown
fields, malformed text and bounds. It cannot prove the interpretation is entailed
by a quote. Factual and stylistic quality require author review and later evals.
There are no tools or commands and source strings are untrusted data. Render all
candidate text as escaped text, never HTML/Markdown or executable templates.

Existing tag-derived scene/beat/continuity records are retained as `structural_only`
with `tag_parser_v1` provenance. Legacy jobs/evidence are `structural_legacy`; their
completed status is not semantic completion. Tag continuity issues still use the
existing author-original review workflow. No automatic cross-book inference or
semantic continuity resolution is claimed. Style category counts are a modest
local candidate aggregate; the paged observations describe the pattern. Background
does not automatically become style.

## Wiring and Activation

`StoryProductionModule.providers` adds only:

```ts
SemanticAnalysisRepository,
SemanticAnalysisService,
SEMANTIC_PROVIDER_FACTORY,
SEMANTIC_WORKER_FACTORY,
```

Factories live in `story-semantic-analysis.worker.ts`. The provider token is
`SemanticAnalysisProvider`; the separate worker token is `SEMANTIC_WORKER`.
The serial runner reuses `StoryContinuationWorker` without editing continuation
code or its registration. `StoryProductionService` delegates analysis methods to
an optional last constructor dependency; missing dependency fails unavailable,
never synchronous mock success. The additive schema/migration is
`20260922190000_story_semantic_analysis`. Apply to the intended DB, then generate
that checkout's own Prisma client. Never mutate a shared/donor client.

All environment variables below use prefix `STORY_SEMANTIC_ANALYSIS_`:

| Suffix | Requirement |
| --- | --- |
| `ENABLED` | Exact `true` to permit new jobs; defaults OFF |
| `WORKER_ENABLED` | Exact `true` as well as ENABLED to start worker; defaults OFF |
| `API_KEY` | Server secret; never put in job pins/logs/client requests |
| `PROVIDER` | Exact `openai` |
| `MODEL` | Dated configured model recognized by pinned js-tiktoken o200k table |
| `RATE_CARD_ID`, `RATE_CARD_VERSION` | Exact active DB rate-card pins |
| `INPUT_KRW_PER_MILLION`, `CACHED_INPUT_KRW_PER_MILLION`, `OUTPUT_KRW_PER_MILLION` | Exact DB KRW rates, decimal strings |
| `INPUT_TOKEN_LIMIT` | Integer 2048..32000 per chunk |
| `OUTPUT_TOKEN_LIMIT` | Integer 512..16000, includes reasoning tokens |
| `MAX_JOB_INPUT_TOKENS`, `MAX_JOB_OUTPUT_TOKENS` | Explicit whole-book bounds, each <=100000000 |
| `MAX_JOB_COST_KRW` | Explicit positive whole-book reservation cap |
| `TIMEOUT_MS` | 100..60000; default 30000 |

There is no default model, key, rate, or monetary budget. Unknown encoding/pin/rate
mismatches fail closed. Current DB card status/provider/model/version/currency/rates
are checked at enqueue and again in the dispatch-fence transaction. Config pins
exclude the key. Changing pinned configuration does not silently switch a queued
job to the new model. Readiness checks do not send a network request.

Both flags must remain OFF for integration until explicitly authorized. This task
does not authorize spending, assess live provider quality/latency, or enable APIs.
The illustrative offline script rates are not a production rate card.

## Durability and Budgets

Planning persists at most 8 chunks per short lease-guarded transaction. Each chunk
uses deterministic refs/hash into the original version, not copied manuscript
text. Long paragraphs are subdivided at surrogate-safe UTF-16 half-open offsets
relative to the original paragraph. No truncation, first-1000 paragraph cap, or
silent omission. The current packaging limit is 32 pieces and 8192-character
target for an 8192-token cap; the offline report quantifies its efficiency before
any packaging change. Empty paragraphs are covered, not silently deleted.

The proven local tokenizer counts the full serialized instructions/schema/input
request, adding 10%+256 tokens. It performs no network counting. All chunks must
be planned and the aggregate input/output/worst-case uncached KRW reservation
accepted BEFORE the first dispatch. Over-cap books fail
`analysis_aggregate_budget_exceeded` with incomplete coverage/semantic flags false.
No reservation is reduced during recovery. This is a PER-JOB bound, not a company
global budget, wallet charge or multi-job spending control. Operator reconciliation
and global admission budgets remain outside this slice.

Actor-scoped idempotency keys serialize across works. Ownership/work/source hash
and locale are checked under locks; a partial unique index reserves one semantic
run per manuscript version, including failed/unknown runs. A new key cannot create
another paid run for that same version. Composite FKs bind job/source/work/owner
and evidence/chunk/job. Source and config/chunk pins become immutable.

Worker claim uses SKIP LOCKED and a 120-second lease. Every mutation verifies the
same unexpired lease/CAS before commit. BEFORE the HTTP adapter, a durable chunk
dispatch timestamp is committed. An expired unfinished fence recovers terminal
`provider_outcome_unknown` before config checks; it never triggers another provider
call. DB persistence failure after a measured success leaves the fence for that
same recovery. The upstream Responses API is NOT assumed idempotent.

Proven pre-transport cancellation can clear the fence under a valid lease. A
dispatched timeout/abort/network error/408/5xx is ambiguous and not automatically
retried. Explicit 429/other rejected HTTP statuses are terminal in this slice,
also without automatic retry. A later administrative retry must reconcile budget
and acceptance, not reset the timestamp casually. Reservations are retained;
unknown actual cost is null, not zero. Cached input and reasoning usage are subsets
of input/output totals, not additional tokens. Known received usage is stored even
when content validation/refusal rejects the output, where available.

The worker polls serially with bounded 250ms..30s backoff and a 75s drain. Nest
OnModuleDestroy aborts and awaits persistence; the existing Prisma
OnApplicationShutdown disconnect follows all module destruction. No runtime hook
monkeypatch. Ensure the application's normal shutdown hooks are enabled at integration.

## Writer Contract and Remaining UI Work

Routes retain the existing application prefix (owned by PM):

- POST `me/creator-studio/manuscripts/:manuscriptId/analyses`, Idempotency-Key, returns queued job projection.
- GET `me/creator-studio/analyses/:analysisId?cursor=<evidence UUID>` returns `{job,evidence,hasMore,nextCursor,endCursor,review}`.
- GET `me/creator-studio/analyses/:analysisId/evidence/:evidenceId/source` returns at most four <=512-unit owned-source quotes checked against hashes.

All routes require owner authentication; GET projections omit raw source, API keys,
provider envelopes and DB exception text. Evidence is monotonic-sequence paged,
100 rows per page, with no first-page claim of full review. `endCursor` lets a caller
resume polling as evidence grows. UI must poll queued/running jobs and support
all pages before presenting author review; it must not call first-page presence
analysis completion or approval. A final-review/publication action remains a
separate existing workflow. There is no evidence approval mutation in this slice.

The API deliberately separates these signals:

| Signal | Meaning |
| --- | --- |
| `job.kind:structural_legacy`, `status:completed`, `semanticCompleted:false` | The old parser finished, not semantic AI approval |
| `job.kind:semantic_extraction_v1`, queued/running phase and progress | Local planning or provider extraction is still in progress |
| Semantic job completed with `coverageComplete:true` | Every pinned source span was processed, not verified understanding |
| Evidence `provenance:structural_only` | Local parser/tag evidence |
| Evidence `provenance:semantic_candidate`, `interpretation:model_inference` | Bounded model observations tied to validated source citations |
| `reviewRequired:true`, `factualTruthApproved:false`, `review.fullyReviewed:false` | Author review is still required even on the final evidence page |

Review/approval flags refer to THIS extraction candidate, not the current live
work publication state. The existing lifecycle endpoint remains authoritative for
work publication. Titles, observations and requested citation quotes are all plain
UNTRUSTED text; escaped rendering is part of the consumer contract, even when the
text says to ignore instructions. Citation validity does not certify factual truth.

Semantic jobs are blocked from the old first-1000/auto-approved memory builder with
`ANALYSIS_EVIDENCE_APPROVAL_REQUIRED`. #1854 owns full approved evidence-to-memory,
cross-book relations/style synthesis, consent and reader memory. Legacy memory
behavior is otherwise retained, not claimed fixed by this slice.

`sourceLocale` is the uploaded language. There is no reader targetLocale, cached
translation or copying Korean into en/ja/zh fields. Five-language UI does not mean
five translated novels. The separate zh-Hans/Hant-only continuation memory filter
gap and release translation bridge are not changed here.

Queued AFTER #1853, not implemented here: #1896 continuation still needs an
author-approved segment length/pacing profile (approximately 10000 Korean
characters), pre-dispatch input/output affordability bounds, minimum length/quality
failure handling rather than short-summary success, no premature forced ending,
and coordinated configurable provider deadline/executor lease/worker drain while
preserving the unknown-dispatch fence. Existing input-token tests alone do not
establish long-form output quality, latency or readiness for a paid test. Actual
model evaluation requires separate explicit paid-test authorization.

## Offline Verification

Only the approved E-drive Imjin and Norse Markdown files are read. They are never
copied into Git/console/provider. The existing converted intake report source and
payload hashes match: body-only projections contain 19537 and104036 paragraphs,
respectively. These numbers are observed, not universal parser expectations.
The converter excludes metadata/choices from body projection; it is not the full
raw Markdown. The read-only script verifies each projected quote in source order.

After the own-dependency slot, run individually (no app bootstrap, no DB/provider):

```text
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin lossless-paste
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse lossless-paste
```

The lossless-paste mode uses a hypothetical local boundary manifest for full source
coverage, NOT author approval or a new uploaded version. Reports contain only
counts/hashes: paragraph/chunk totals, full framed input tokens, buffered input and
output reservations, tiny (<256 non-whitespace UTF-16 units) and empty-only chunk
counts, unchanged-source/full-span hashes and illustrative whole-job cap outcome.
Passing source coverage is not semantic, cross-book memory, style or latency quality.

Authoritative full Markdown line shapes are 48953 paragraphs (22593 blank) for
Imjin and218961 (106857 blank) for Norse. Norse exceeds the current intake's200000
paragraph cap. The offline full-source mode runs that same parser per part and
reports `currentIntakeSupported:false`; it does not relax the admission cap or
claim a successful whole-book upload. Existing body projections and complete raw
source are different coverage scopes, both retaining `sourceLocale:ko`.

Focused fake transport/source/lifecycle tests and guarded actual PG tests are
`story-semantic-analysis.*.spec.ts`; PG requires
`STORY_ANALYSIS_TEST_DATABASE_URL` pointing only to the dedicated loopback
`lumina_analysis_qa` database. Use direct Jest `--runInBand` so npm pretest does not
generate another checkout's client.
The defaults-OFF AppModule smoke uses the real module graph and own Prisma/QA DB,
loopback health200 and clean close; provider keys/rate-card settings are absent and
external fetch is forbidden. It does not replace PM's full authenticated writer
HTTP boundary tests.

### Focused Results (2026-09-22)

- Own physical `node_modules`: `npm ci --ignore-scripts`, 746 packages, 52s; no dependency/lockfile changes.
- Own Prisma6.19.3 generate and schema validate: PASS.
- Fresh dedicated QA DB: all63 migrations, including20260922190000, applied successfully.
- Whole server `tsc --noEmit --incremental false`: PASS after correcting two inferred usage-return type errors.
- Provider/source: 2 suites,39 PASS,0 FAIL,0 SKIP (32.257s).
- Projection/lifecycle/existing continuity service: 3 suites,10 PASS,0 FAIL,0 SKIP (19.618s).
- Actual PostgreSQL pipeline: 1 suite,17 PASS,0 FAIL,0 SKIP (50.531s).
- Actual AppModule defaults-OFF boot/health200/clean close: 1 suite,1 PASS,0 FAIL,0 SKIP (31.364s).
- Total focused results: 7 suites,67 PASS,0 FAIL,0 SKIP. All processes exited normally.

The first PG run exposed advisory-lock `void` deserialization via `$queryRaw`;
the repository now uses `$executeRaw` as the existing purchase implementation does.
The next run exposed fixture issues (duplicate source hash and forbidden DELETE of
append-only history). Dedicated-DB guarded TRUNCATE cleanup fixed the test fixture;
production history triggers were not changed or disabled. The final17-case run
includes real cross-client reservation/lease tests, pre-send cancellation, expired
paid-dispatch/failure-persistence recovery, before-first-dispatch aggregate bounds,
source immutability, pagination and approval separation.

Not run yet: full actual-source tokenizer/planner reports below, broad shared story
regression, PM authenticated writer HTTP integration, and live model quality/latency.
No fallback/mock completion is enabled by these tests; fake transports are test-only.

## Official API References

Read the OpenAI skill and searched then fetched official docs before adapter work:

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/typescript/resources/responses/methods/create

Responses uses `text.format` strict JSON schema, `store:false`, no tools,
`truncation:disabled`, bounded output tokens including reasoning. Refusals and
incomplete/malformed outputs are not schema success. Both streamed response bytes
(256000) and extracted JSON text (100000 bytes) are bounded before persistence.
