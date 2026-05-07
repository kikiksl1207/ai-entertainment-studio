# CS-001 - Creator Studio Settlement Conversion Request UI

Owner: Builder B / Frontend
Status: ready
Area: Creator Studio
Related: #165

## Goal

Connect the Creator Studio "settlement amount to Lumina charge request" flow. This is a request-only flow. It must not look like instant exchange or immediate wallet credit.

## Read

- `docs/ops/agents.md`
- `docs/ops/board.md`
- this task file
- `creator-studio.html`
- `app.js`
- `styles.css`

## API

List:

```http
GET /api/v1/me/creator-studio/settlement-conversions?period=YYYY-MM&status=requested
Authorization: Bearer <accessToken>
```

Create:

```http
POST /api/v1/me/creator-studio/settlement-conversions
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Body:

```json
{
  "settlementKey": "artist:<artistId>:YYYY-MM",
  "amountKrw": "1000",
  "note": "optional memo",
  "idempotencyKey": "optional-client-generated-key"
}
```

Policy:

- Minimum amount: 1000 KRW.
- 1 Lumina = 10 KRW.
- Created request does not increase wallet balance.
- Admin/accounting approval is required.
- Do not use the Korean term `환전`.
- User-facing term: `정산금으로 충전`.

## Implementation Direction

- Use the existing Creator Studio settlement area if present.
- Add or connect a `정산금으로 충전` action.
- Show a small modal/form for amount and optional note.
- Use available `settlementKey` from the settlement preview data. Do not ask operators to type slug manually.
- On success, show request status as requested and refresh the conversion list.
- If the backend returns amount-exceeds-preview details, show remaining/available amount safely.
- Keep Creator Studio gate behavior intact.

## Acceptance Criteria

- Authorized Creator Studio user can open the request form.
- Request body uses `settlementKey`, not artist slug.
- Success does not imply immediate wallet credit.
- Existing Creator Studio access gate still works.
- Existing settlement preview still renders.
- Browser console has no new uncaught errors.

## Completion

Write result to `docs/ops/inbox/builder-b.md`.
