# Story Progress Controls #1872-#1876

This delivery extends the production story backend with server-owned custom choice, checkpoint, reset quota, and public progress controls.

## APIs

- `POST /api/v1/me/story-progress/:progressId/custom-choice` accepts a paid-session custom choice after active entitlement, published version, length, whitespace, blocked-term, moderation, revision, and idempotency checks. The response never echoes the private input.
- `GET|POST /api/v1/me/story-progress/:progressId/checkpoint` reads or confirms the last stable scene and beat through optimistic progress revisions.
- `GET /api/v1/me/story-progress/:progressId/reset-preview` returns the target scene, invalidated event count, and remaining quota without mutation.
- `POST /api/v1/me/story-progress/:progressId/reset` atomically consumes one quota unit, invalidates applicable choice events, updates progress, creates a checkpoint, and writes sanitized audit metadata.
- `GET /api/v1/me/stories/:workId/progress-state` returns capability booleans, numeric quotas, checkpoint labels, and message keys without internal identifiers or custom choice history.
- `POST /admin/api/v1/story-progress/reset-quota-adjustments` is wildcard-admin-only and records idempotent operational compensation in a separate immutable adjustment ledger.

## Persistence and authority

- Full reset has one bucket per user and work. Each act has an independent three-use bucket.
- Quota buckets are not keyed by story version, so publishing a new version does not restore usage. A full reset may reconcile progress to the new published version; an act reset may not cross a version mismatch.
- Reset preserves entitlements and visited ending keys. Choice events are retained for audit and marked invalid instead of deleted.
- Fixed choices and beat writes use optimistic progress revisions. Existing sessions cannot use the legacy start route to bypass reset or checkpoint commands.
- Custom input is stored only in the dedicated private choice table for downstream processing. It is not placed in audit metadata, analytics, public projections, or response payloads.

## Verification

Apply `0048_story_production_backend` before `0049_story_progress_controls`. Run server build, story-production tests, Prisma validation, lint, and `npm run qa:story-progress-controls`. Staging execution requires a published test story and an approved test identity supplied through the private QA channel; completion reports contain only non-secret run status.
