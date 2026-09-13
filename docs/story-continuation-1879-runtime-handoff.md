# #1879: Status Scope and Next Runtime Contract

Scope: first bounded step from main `f750c39e5d8630e9c764321809467e76e8f1b711`; next-runtime items below are proposals, not executed AI.
Authority: PM `RESTART_2026-09-13.md` and `workboard.md` #1879 current scope, with #1853/#1854; no board edits.
Source references below are repository-relative at this candidate; no manuscript, live API/DB, provider, payment or publishing access.

## Implemented Boundary
- `server/src/story-production/story-economics.controller.ts:40` binds both URL IDs; `story-economics.service.ts:848` requires user/progress/continuation and filters all three.
- Missing arguments fail closed before Prisma can omit undefined filters; wrong parent, foreign user and absent record share the existing safe 404.
- No extra progress lookup: request creation already checks owned progress transactionally (`story-economics.service.ts:617`) and copies its ID/user into the continuation (`:718`); status only reads that tuple, not current revision/release.
- This preserves historical status after progress changes without adding a new visibility rule. The unchanged projection (`story-economics.service.ts:1417`) omits private input, provider payload, context and costs; GET performs only continuation/allowance reads.
- `story-economics.service.spec.ts` uses filter-aware multi-progress fixtures, real controller/service calls, route metadata, exact public projections and a strict read-only adapter; first-release custom denial/reset/choice code is unchanged.

## Existing Evidence and Gaps
- `server/prisma/schema.prisma:1741`: StoryChoice has routeKind (string, default branch), targetSceneId, targetEndingKey and declaredRejoinSceneId; these do not specify an AI execution policy.
- `story-production.controller.ts:142` selects a stored choice; `story-production.service.ts:592` checks ownership/state/revision/release/entitlement and follows its stored target, recording selected path/events. routeKind is projected/logged, not an executor switch.
- `server/prisma/schema.prisma:2147`: StoryAiContinuation requires unique customChoiceId. Existing requestCustomChoice (`story-economics.service.ts:605`) cannot represent a recommended choice without a compatibility change; fake custom records are prohibited.
- Existing preparation (`story-economics.service.ts:548`) reads approved work-level memory and recent non-invalidated progress event IDs; contextReferences (`:732`) are useful scaffolding, not a complete version-pinned selected-path snapshot.
- Queue/reservation/ai_pending already exist (`story-economics.service.ts:605`); queued/processing and startedAt exist, but no story claim/lease/retry executor or provider is registered (`story-production.module.ts:21`).
- Settlement (`story-economics.service.ts:868`) checks cost/tokens/consent/moderation, writes scene/beats and provenance, updates progress and consumes/releases allowance; failure restores a checkpoint, and compensation is separate (`:1116`). Reuse with race tests, not an assumption of exactly-once execution.
- Settlement DTO (`dto/story-economics.dto.ts:253`) has title/beats, no next-choice/ending/complete visual contract. Created scene (`story-economics.service.ts:965`) has only visual provenance; reader projection (`story-production.service.ts:1083`) requires usable stored visuals/choices. AI playback is not complete.

## Smallest Next Phase (Separate Authorization)
- First settle the authored-target versus AI-generated route policy with PM: identify which recommendations advance authored targets and which request generation, with explicit provenance. Do not reinterpret branch/rejoin or replace authored routes silently.
- Extend the existing continuation persistence with an explicit recommended/custom request discriminator and validated exclusive choiceId/customChoiceId references, preserving old custom rows; migrate only in a separately reviewed change, never by inventing custom input.
- Reuse the recommended-choice POST guards and reservation transaction for an AI-designated choice: pin work/manuscript/release, scene/act/checkpoint, state/revision, ordered valid choice history/effects, locale and rights/consent/analysis versions; atomically reserve budget and mark ai_pending with scoped idempotency.
- Then add a durable claim/lease/attempt executor: bounded retry/timeout, duplicate/crash recovery, request-scoped context and pre-execution authorization; reuse settlement/compensation primitives with atomic release/version/reset/consent rechecks and one-time reservation settlement. No provider call in this step.
- Validate generated beats plus playable background/character visual data and at most three genuinely distinct next choices, or an explicit ending; persist and verify through reader GET before declaring completion. Free and paid both allow at most three recommendations; custom input stays deferred and reset limits remain unchanged.
- Preserve diverse consequences, authored versus reader paths and declared-only rejoins; never force all branches together for cost savings. Reuse must match work/manuscript/release, state/history/effects, locale, model/prompt and rights/consent revisions with access checks; keep cross-session reuse off until proven safe.
- Use authorized, version-matched #1853/#1854 analysis/evidence/style only: existing structured analysis is tag parsing (`story-production.policy.ts:147`), with owner/version/style-consent checks in `story-lifecycle.service.ts:306`; do not claim semantic analysis or learned style is already available.
- Offline gates: duplicate/crash/retry/timeout, authorization withdrawal, version/reset races, reservation/settlement once, context isolation, distinct choices/endings and replayable GET. PM must separately confirm provider/model, budget and authorized source/account before any real execution; candidate freezes for independent QR, not full #1879 completion.
