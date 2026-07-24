# Story Production Backend #1821, #1823, #1832, #1837-#1840, #1853-#1854

This delivery turns the existing Story Stage contracts into server-owned production data and APIs.

## Public and reader APIs

- `GET /api/v1/stories` returns a cursor-bounded published catalog with five-locale fallback.
- `GET /api/v1/stories/:slug` returns published parts, entitlement-aware actions, replay state, and ending records.
- `GET /api/v1/me/stories/:workId/access` returns the authenticated reader's server-priced access, purchase/resume/reset/ending actions, and AI allowance without performing a mutation.
- `POST /api/v1/stories/:workId/purchase` grants a server entitlement through an atomic, idempotent wallet debit.
- `POST /api/v1/stories/:workId/progress` supports continue, restart, and previously seen checkpoints without replay charges.
- `GET /api/v1/me/story-progress/:progressId` returns only the current scene's short beats, visual manifest, visible choices, direct-next hints, and a bounded path tail.
- `GET /api/v1/story-sessions/:sessionId/current-scene` is the authenticated player alias. Its visual manifest is allowlisted to rights-cleared public paths, locale-neutral fallback metadata, and at most four character layers.
- `POST /api/v1/me/story-progress/:progressId/beat` persists the current beat position after checking it belongs to the active scene.
- `POST /api/v1/me/story-progress/:progressId/choices/:choiceId` persists the selected edge and explicit rejoin marker.

Only `published`, non-fixture works, parts, scenes, and public asset manifests can enter these projections. Unsafe rows produce an empty catalog result or a not-found state; they never produce synthetic success data.

## Creator APIs

- `GET /api/v1/me/creator-studio/stories` returns only the authenticated owner's non-fixture works as title-centered selector items with creator permissions. The UI must bind the returned `workId`; it must not ask for a manually entered work ID.
- `GET /api/v1/stories/:workId/graph` is owner-only and returns a localized, bounded neighbourhood around one scene. It includes the current part, choices, direct next scenes, and user-safe warning codes projected from the latest relevant release validation; validator identifiers and manuscript content are not returned.
- `POST /api/v1/me/creator-studio/stories/:workId/manuscripts` stores an immutable structured paste with stable content hashing.
- `POST /api/v1/me/creator-studio/manuscripts/:manuscriptId/analyses` runs idempotent versioned structural analysis.
- `GET /api/v1/me/creator-studio/analyses/:analysisId` returns evidence linked to the source part and paragraph index.
- `GET /api/v1/me/creator-studio/stories/:workId/continuity` returns entities, events, foreshadow/payoff entries, issues, and the critical publish gate.
- `POST /api/v1/me/creator-studio/stories/:workId/continuity/:issueId/decision` records an owner decision without editing the manuscript.

Structured analysis recognizes paragraph and dialogue boundaries plus explicit `[background:name]`, `[cast:name]`, `[time:name]`, `[place:name]`, `[branch:name]`, `[entity:name]`, `[event:name]`, `[foreshadow:name]`, and `[payoff:name]` evidence tags. A foreshadow entry without a matching payoff creates an unresolved critical issue that blocks publication.

## Verification

Run `npm run build`, the story production tests, `npm run qa:story-production-release`, `npm run qa:story-access-projections`, and `npm run qa:story-player-read-apis`. The QA commands emit only a run ID, public path, status, boolean checks, and mutation status. Applying migration `0048_story_production_backend` and exercising a real published story require a configured staging database and an approved non-secret test identity; no credential material belongs in reports.
