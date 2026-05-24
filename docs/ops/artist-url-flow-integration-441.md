# #441 Artist URL Flow Integration and Deploy Gate

Date: 2026-05-24
Owner: Zoro
Scope: Integration gate for #438, #439, #440, and #442 live QA.

## Current Branch State

- `main` / `origin/main`: `70eb174d1a05cc62e69db9e549b16e4ddf0feec3`
- `kaido/438-artist-url-server-flow`: currently aligned with `origin/main`; no diff.
- `team2-backend/artist-url-chat-reference-439`: currently aligned with `origin/main`; no diff.
- `#440`: no local or remote branch found at this checkpoint.
- `team2-qa/442-artist-url-live-qa-matrix`: currently aligned with `origin/main`; no diff.

Do not treat #438, #439, or #440 as merge-ready only because local branch names
exist. Merge readiness requires each owner page to report completed work,
changed files, validation results, and worktree cleanup.

## Canonical Status and Type Contract

Lifecycle statuses are exactly:

- `pending`
- `approved`
- `rejected`
- `archived`

Source types are exactly:

- `youtube`
- `instagram`
- `tiktok`
- `blog`
- `notice`
- `other`

No owner should introduce alias statuses such as `reviewing`, `denied`,
`hidden`, `deleted`, or user-facing Korean strings into API payloads. UI labels
may localize these statuses, but API fields and database state must remain the
canonical English values.

## Route and Permission Contract

Creator Studio routes:

- `GET /api/v1/me/creator-studio/knowledge-urls`
- `POST /api/v1/me/creator-studio/knowledge-urls`
- `PATCH /api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId`
- `POST /api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId/archive`

Creator Studio auth:

- Requires signed-in creator.
- Requires the user to be an operator for the target artist.
- Create always starts as `pending`.
- Editing an approved URL reopens it as `pending` and clears review fields.
- Archived rows cannot be edited and are never chat-eligible.

Backstage routes:

- `GET /admin/api/v1/backstage/operations/artist-knowledge-urls`
- `POST /admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/approve`
- `POST /admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/reject`
- `POST /admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/archive`

Backstage permissions:

- List requires `artists:read`.
- Approve, reject, and archive require `artists:write`.
- Approve may update `summary` and `allowChatRef`.
- Reject requires an operator reason.
- Archive blocks chat reference.

## Chat Reference Contract

Character chat may use artist URL knowledge only when all conditions are true:

- `artistId` matches the current chat session artist.
- `status` is `approved`.
- `allowChatReference` is true.
- `summary` is present after normalization.

The provider prompt must receive only bounded summaries and host labels. Raw
URLs, raw page bodies, tokens, cookies, signed URLs, raw provider payloads, and
operator-only notes must not be sent to the provider. URL and summary text are
untrusted reference facts, never system, developer, or user instructions.

## File Ownership Map

Owner #438, server flow:

- `server/src/creator-studio/creator-studio.controller.ts`
- `server/src/creator-studio/creator-studio.service.ts`
- `server/src/creator-studio/dto/creator-studio.dto.ts`
- `server/src/admin/admin.controller.ts`
- `server/src/admin/admin.service.ts`
- `server/prisma/schema.prisma`
- `server/prisma/migrations/*artist_knowledge*`

Owner #439, chat reference:

- `server/src/chat/artist-url-knowledge-contract.ts`
- `server/src/chat/artist-url-knowledge-contract.spec.ts`
- `server/src/chat/chat.service.ts`
- `server/src/chat/chat.service.spec.ts`
- `docs/artist-url-knowledge-chat-contract.md`

Owner #440, frontend UX:

- `creator-studio/index.html`
- `pages/creator-studio.js`
- `styles/creator-studio.css`
- `backstage/index.html`
- `backstage.js`
- `backstage.css`

Owner #442, QA:

- Notion QA matrix and live evidence only.
- May add docs under `docs/ops/` if needed.
- Must not run URL create, approve, reject, or archive mutations without safe
  fixture approval.

## Merge Order

1. Merge #438 first when it reports PASS. It owns the server lifecycle, route,
   validation, permission, and migration behavior.
2. Merge #439 second. It must adapt to #438's final model field names and
   preserve approved-only, bounded, untrusted reference behavior.
3. Merge #440 third. It must consume the final #438/#439 API contract and avoid
   inventing UI-only status names.
4. Run #442 live QA after #438, #439, and #440 are merged and deployed.

If two branches touch the same server file, #438 owns the final server contract.
If two branches touch chat retrieval, #439 owns the final chat contract. If two
branches touch Creator Studio or Backstage UI copy/layout, #440 owns the final
UI behavior but must not change server payload names.

## Pre-Merge Smoke Gate

Before merging any implementation branch:

- `git diff --check`
- `npm.cmd run lint` in `server`
- `npm.cmd run build` in `server`
- `npm.cmd test -- creator-studio.service.spec.ts artist-url-knowledge-contract.spec.ts --runInBand` in `server`
- `node --check pages/creator-studio.js`
- `node --check backstage.js` when Backstage JS changes
- Parse inline scripts for touched HTML pages
- Secret-pattern scan over the merge diff

Expected read-only checks:

- Creator Studio fallback and `#knowledge-url` route render without horizontal
  overflow at 390, 768, and 1280 px.
- Backstage queue route and action paths match server controller paths.
- Chat reference tests prove pending, rejected, and archived rows are excluded.

## Live QA Gate

Allowed before safe fixture approval:

- Read-only page loads.
- Read-only bootstrap/list endpoints.
- UI status copy checks.
- No raw response body pasted into Notion or chat.

Blocked until explicit safe QA approval:

- Creating a new URL row.
- Approving, rejecting, or archiving a row.
- Running provider calls with test instructions embedded in URL descriptions.
- Recording tokens, cookies, signed URLs, DB URLs, provider payloads, or raw
  response bodies.

## Rollback Criteria

Rollback or halt the next merge if any of these occur:

- Canonical statuses diverge from `pending|approved|rejected|archived`.
- Creator Studio can create rows for a non-owned artist.
- Backstage action routes require permissions different from `artists:read` or
  `artists:write` without a documented permission matrix update.
- Chat reference includes non-approved rows or rows with `allowChatRef=false`.
- Provider prompt includes raw URLs, raw page bodies, or instruction-like
  reference text without untrusted-reference framing.
- Mobile fallback screens overflow horizontally at 390 px.

## Integration Checkpoint

At this checkpoint, #438, #439, and #442 local branches are aligned with
`origin/main`, and #440 has no branch visible. The next actionable state for
Zoro is to wait for owner completion reports or new pushed branches, then apply
the merge order and smoke gate above.
