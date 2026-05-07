# BA-001 - Backstage / Creator Studio Backend Contract Check

Owner: Builder A / Backend
Status: ready
Area: Backend

## Goal

Confirm that today's Backstage and Creator Studio frontend tasks already have backend support. Add only small backend contract notes or diagnostics if a real gap is found.

## Read

- `docs/ops/agents.md`
- `docs/ops/board.md`
- this task file
- `server/src/admin/admin.controller.ts`
- `server/src/admin/admin.service.ts`
- creator studio controller/service files under `server/src`
- `docs/creator-revenue-settlement-spec.md`

## Checkpoints

1. Backstage object storage diagnostics exists:
   - `GET /admin/api/v1/backstage/operations/object-storage/diagnostics`
   - Does not return secrets.
2. Backstage settlement conversion admin status update exists:
   - `GET /admin/api/v1/backstage/settlement-conversions`
   - `POST /admin/api/v1/backstage/settlement-conversions/:conversionId/status`
3. Creator Studio settlement conversion request exists:
   - `GET /api/v1/me/creator-studio/settlement-conversions`
   - `POST /api/v1/me/creator-studio/settlement-conversions`
4. Creator Studio access endpoint remains stable:
   - `GET /api/v1/me/creator-studio`
5. Error responses include enough details for frontend display without exposing secrets.

## Write Scope

Allowed:

- `server/`
- `docs/`

Avoid:

- `app.js`
- `creator-studio.html`
- `backstage.js`
- `backstage.html`
- `styles.css`

## Acceptance Criteria

- If no backend gap exists, do not invent code changes. Write a clear inbox note.
- If a backend gap exists, patch it narrowly.
- Run:
  - `npm.cmd run lint`
  - `npm.cmd run build`
- Commit only if files changed.

## Completion

Write result to `docs/ops/inbox/builder-a.md`.
