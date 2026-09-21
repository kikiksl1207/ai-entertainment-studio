# Story AI Activation Evidence Handoff (#1895)

## Boundary

`approved_configuration` is only an input. A separate explicit legal activation,
current consent revision, exact release/manuscript/owner scope, locale and region
are required. `STORY_AI_REGION` is a trusted deployment jurisdiction (two uppercase
letters), not a client-supplied override. Missing configuration fails closed.
This is not reader geolocation or a production authorization to enable reuse.

Production provider registration remains disabled in this branch. PM owns final
provider module wiring. No provider, executor, worker or repository files changed.
Custom input remains off. No route convergence was introduced.

## Admin API

All paths below are under `/admin/api/v1/story-ai`, protected by the existing
`AdminAuthGuard`, `AdminPermissionGuard`, and required permission `*`.
No new operational authority is inferred or automatically assigned.

| Method and Path | Request / Response |
| --- | --- |
| POST `legal-activations` | `CreateStoryAiActivationDto`: release, rights version, consent ID/revision, locale/region, moderation policy/evaluator versions, fixed quality rubric, SHA-256 evidence hash, starts/expires dates, `legalActivationConfirmed: true`. Returns ID/time. |
| POST `legal-activations/:id/revoke` | `{ evidenceHash }`; append-only revocation, replay returns original ID/time. |
| GET `shared-results/review-queue` | `limit` default 20, 1..50; optional UUID `cursor`. Oldest review-pending first, `(reviewPendingAt,id)` ascending. Returns `items` and `nextCursor`. Items: result/work/release IDs, locale, checksum, review timestamp. |
| GET `shared-results/:id/review` | Result metadata, review state, checksum validity/computed checksum, evidence metadata (bounded 100), and sanitized content: localized title, ordered beats/choices, ending key, projected visual and origin checksum. No user/reviewer IDs, prompts, manuscript or provider context. |
| POST `shared-results/:id/evidence` | `CreateStoryAiEvidenceDto`: origin UUID, result checksum, kind moderation/quality, decision allow/reject/revoke, sequential revision, prior evidence UUID as `supersedesId`, policy/evaluator versions, hash and expiry. Returns evidence ID/revision/time. |
| POST `shared-results/:id/promote` | `{ resultChecksum }`; locks result, checks live activation/evidence and recomputed private output checksum, copies beats/choices atomically, links origin, audits approval. Returns ID/status/idempotentReplay. |
| POST `shared-results/:id/revoke` | `{ evidenceHash }`; terminal revocation with audit. Repeating is safe. |

Quality policy is pinned to `story-ai-quality-admin-v1`, evaluator
`explicit-admin-v1`. An allow decision requires `qualityRubricConfirmed: true`:
the administrator explicitly attests continuity, distinct choice outcomes,
locale, playable completeness and absence of private content. This technical
rubric/API is not a substitute for business approval of the final review policy.
Moderation evidence must be explicitly submitted; settlement preview strings do
not generate evidence. Evidence contains hashes and version identifiers only.

## Lifecycle and Persistence

- `prepare(context, tx)` checks legal eligibility and pins evidence policy versions
before a result exists. It cannot approve a result.
- Legal generation uses `requireReuse=false`; a private-generation-only contract
  can legally activate and generate without any shared claim/evidence. Shared
  preparation, promotion and hits additionally require generated-result reuse rights.
  Newer unapproved drafts do not supersede an effective approved rights version.
- Settlement writes the first personal scene, then records the shared claim's
  immutable `originGeneratedSceneId`, checksum and `reviewPendingAt`. Shared status
  stays `pending`; the API projects `review_pending`. No shared beats/choices yet.
- Other readers wait without a second reservation/provider request. Failed claims
  still release their token under the existing retry protocol.
- Explicit promotion requires both current allow evidence rows for the same
  origin/checksum, with exact policy/evaluator versions, and live legal activation.
- `authorizeResult(context with resultId/checksum, tx)` rechecks immediately before
  a hit. Result, activation and consent locks serialize relevant revoke/update
  races. New rights revisions, expiry, consent changes and revocation fail closed.
- The second exact-context reader receives new personal progress, scene, event
  and ledger records. No allowance mutation, provider call, tokens or AI cost.
- Activation and evidence history are append-only. Superseding evidence references
  the previous revision; its timestamp records supersession/revocation. Rejected
  or revoked evidence also atomically revokes an already-approved result.
- New SQL guards validate owner relations, active evidence, exact copied output,
  immutable reviewed origin and terminal shared lifecycle. Legacy unbacked approved
  rows cannot pass the runtime gate; no legacy approval is synthesized.
- Review/promote recompute SHA-256 from the same helper used by settlement:
  title, beats (type/content), visual, next choices (key/label), ending or null.
  Invalid historical payload shows `invalid_checksum`; promotion rejects it.

## Verification and Remaining Limits

Run Jest directly to avoid the package pretest generate hook. Real PostgreSQL
specs are opt-in via `STORY_TEST_DATABASE_URL`; the fixture refuses non-loopback
or non-test/QA database names. It uses synthetic users/content, real constraints
and real economics/activation/gates; provider is an offline test double. One test
deliberately injects historical corruption with a transaction-local trigger bypass,
then restores normal constraints before asserting checksum rejection.

The prior ownership suite now creates valid activation/evidence and explicitly
promotes its source fixture instead of directly fabricating an approved row.

Candidate verification (2026-09-22): 58 fresh migrations applied to the verified
disposable database; Prisma validate, TypeScript noEmit, story-production ESLint
and git diff whitespace checks passed. Final story-production selection:
29 suites passed, 349 tests passed, 1 existing skip. This includes 21 real-PG
tests covering private-only generation, newer draft vs approved versions, corrupt
checksum rejection, exact second-reader zero-cost reuse, concurrent promotion,
revocation and ownership constraints. Prisma client generated once; no install
or further generate performed. Legacy Imjin fixture preservation was not rerun
against a restored legacy database in this slice (fresh synthetic DB only).

Operations remain blocked on independent review, final legal/reviewer/rubric
approval, real provider configuration and #1897 rolling route identity. Current
bounded semantic history does not prove equivalence of arbitrary long histories
after canonical rejoin. This change does not claim to solve that issue.
No live API/provider, publish, payment, production migration, deployment or push.
