# QA Debut Status Owner Projection Runbook #259

Purpose: give QR a safe way to re-check the user-facing debut application status
projection for `needs_more_info`, `approved_for_contact`, and `rejected` without
opening any dispatch, settlement, contract, or admin mutation path.

## Scope

- Read-only endpoints only:
  - `GET /api/v1/me/debut-applications`
  - `GET /api/v1/me/debut-applications/latest`
  - `GET /api/v1/me/debut-applications/:applicationId/status`
- Owner account only. Use a disposable QA user or a staging/local fixture user.
- Do not write credentials, cookies, JWTs, signed URLs, storage keys, passwords,
  or environment values in Git, Notion, PRs, screenshots, or QA notes.
- Do not use real applicant data.
- Do not run or expose POST/PATCH status, notification dispatch, settlement,
  contract, payout, wallet, Lumina, or paid-like mutations for this smoke.

## Fixture Matrix

Create or select three disposable staging/local debut application records owned
by the same QA user. If direct DB setup is used, keep it in a staging/local-only
environment and record only non-secret row identifiers in QA notes.

| Raw record status | Expected user status | Required public data | Must stay hidden |
| --- | --- | --- | --- |
| `needs_more_info` | `needs_more_info` | `publicNotice.publicReason`, `requestedActionKey` if present | contact values, intro, `reviewNote`, consultation/rights/partner notes, private material URLs, storage keys, object ETags |
| `approved_for_contact` | `approved` | approved copy/message keys, `settlementOrContractFinalized=false` | any contract, payout, settlement, final share, contact values, admin notes |
| `rejected` | `rejected` | `publicNotice.publicReason` if present | private rejection memo, contact values, intro, internal metadata, private material URLs |

The backend unit fixture `DebutService projects <status> as a safe owner-only QA
fixture` covers the same three states. Use it as the branch-level regression
fixture before QR live/staging smoke.

## Executable Fixture Script

The repo includes a QA-only helper for creating the three owner fixture rows:

```powershell
cd server
$env:DEBUT_STATUS_QA_FIXTURE_CONFIRM="CREATE_DEBUT_STATUS_OWNER_FIXTURES"
$env:DEBUT_STATUS_QA_USER_ID="<disposable QA owner user uuid>"
$env:DEBUT_STATUS_QA_TARGET_ENV="staging"
npm.cmd run qa:debut-status-fixtures
```

Dry-run check without database writes:

```powershell
cd server
$env:DEBUT_STATUS_QA_FIXTURE_CONFIRM="CREATE_DEBUT_STATUS_OWNER_FIXTURES"
$env:DEBUT_STATUS_QA_USER_ID="<disposable QA owner user uuid>"
$env:DEBUT_STATUS_QA_FIXTURE_DRY_RUN="true"
npm.cmd run qa:debut-status-fixtures
```

Script behavior:

- Creates only `debut_applications` fixture rows for the provided owner user.
- Creates one row for each raw status: `needs_more_info`,
  `approved_for_contact`, and `rejected`.
- Marks rows with `metadata.qaFixture.task="#259"` and a `runId`.
- Prints only row ids, statuses, run id, and owner status endpoint paths.
- Does not print credentials, cookies, JWTs, signed URLs, storage keys,
  passwords, secrets, or environment values.
- Does not send email/in-app notifications.
- Does not touch wallet, Lumina, settlement, payout, boost, paid-like, contract,
  or artist operator state.
- Refuses production-like environments unless
  `DEBUT_STATUS_QA_FIXTURE_ALLOW_PRODUCTION=true` is explicitly set for an
  approved live-safe QA owner run.

## Expected Response Checks

For each fixture, sign in as the owner and call the status endpoint for that
application id. The response should include:

- `readOnly=true`
- `ownerOnly=true`
- `application.status` from the expected user status column above
- `application.messageKey` with a `debut.application.status.*` key
- `application.cta.enabled=false`
- `application.materialSummary.metadataOnly=true`
- `application.publicNotice.dispatch.contractOnly=true`
- `application.publicNotice.dispatch.inAppSent=false`
- `application.publicNotice.dispatch.emailSent=false`
- `application.publicNotice.internalAdminNoteReturned=false`
- `application.publicNotice.settlementOrContractFinalized=false`
- `application.privacy.contactReturned=false`
- `application.privacy.introReturned=false`
- `application.privacy.adminReviewNoteReturned=false`
- `application.privacy.internalMetadataReturned=false`
- `application.privacy.privateMaterialUrlReturned=false`

For non-submitted states, `application.statusHistory` should contain the initial
`submitted` entry and the current user-facing status entry. Existing
`approved_for_contact` records must appear to users as `approved`, but this means
contact or next-step readiness only. It must not imply debut confirmation,
settlement, contract finalization, payout, or final revenue share.

## Negative Checks

- Calling another user's application id from the QA owner session should not
  return the record.
- The response body must not contain applicant email, phone, intro text,
  admin/reviewer memo text, private material URL, signed URL, storage key, object
  ETag, secret, token, password, or environment value.
- No email or in-app notification should be sent by this read-only smoke.
- No wallet, Lumina, settlement, payout, boost, or paid-like state should change.

## Handoff

After this runbook branch is merged and deployed to the QA target, QR can run the
three-state owner projection smoke with disposable records only. If safe fixture
records are not available in the target environment, report `BLOCKED` with
`blocked_by: safe debut status owner fixtures needed`.
