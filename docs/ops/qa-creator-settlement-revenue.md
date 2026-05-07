# QA Creator Settlement Revenue

Use this only to test Creator Studio settlement conversion when the creator has
no real settlement-preview revenue yet.

The Creator Studio preview is calculated from revenue events such as fan
letters, gifts, paid likes, chat orders, and premium video unlocks. Updating a
manual settlement record alone does not open the conversion modal.

## Safety

- Endpoint is admin-only.
- Endpoint is disabled unless `ENABLE_BACKSTAGE_QA_TOOLS=true`.
- It creates a QA-marked fan letter revenue event without a wallet ledger.
- Delete the QA fan letter after testing.
- Do not use this for real payouts, accounting, or production settlement.

## Create QA Revenue

`POST /admin/api/v1/backstage/operations/qa/creator-settlement-revenue`

```json
{
  "operatorEmail": "creator@example.com",
  "artistId": "optional-artist-uuid",
  "amountLumina": 2000
}
```

If `artistId` is omitted, the newest active artist operator row for the creator
is used.

The response includes `cleanup.path`.

## Delete QA Revenue

`DELETE /admin/api/v1/backstage/operations/qa/creator-settlement-revenue/<fanLetterId>`

Only fan letters created by this QA endpoint can be deleted here.

## QA Flow

1. Temporarily set `ENABLE_BACKSTAGE_QA_TOOLS=true` on the deployed backend.
2. Create QA revenue for the creator operator.
3. Refresh Creator Studio settlement preview.
4. Open the settlement conversion modal and submit a request.
5. Delete the QA revenue record.
6. Turn `ENABLE_BACKSTAGE_QA_TOOLS` off again.
