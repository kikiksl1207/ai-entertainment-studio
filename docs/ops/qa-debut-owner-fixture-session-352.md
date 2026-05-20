# QA Debut Owner Fixture Session Runbook #352

Purpose: prepare a safe disposable owner fixture/session path so QR1 can smoke
the owner-only debut status pages for `needs_more_info`,
`approved_for_contact`, and `rejected`.

## Scope

- Use staging/local or an explicitly approved QA-only live-safe owner.
- Do not run real applicant approval, rejection, resubmission, dispatch,
  settlement, payout, wallet, Lumina, contract, or paid-like mutations.
- Do not use real applicant data or a real user account.
- Do not record raw email, password, token, cookie, DB URL, signed URL, storage
  key, private material URL, S3 credential, or environment value in Notion, Git,
  PRs, screenshots, or chat.
- QR1 should receive credentials only through the private QA credential channel.

## Fixture Creation

Dry-run first from `server`:

```powershell
$env:DEBUT_STATUS_QA_FIXTURE_CONFIRM="CREATE_DEBUT_STATUS_OWNER_FIXTURES"
$env:DEBUT_STATUS_QA_USER_ID="<disposable QA owner user uuid>"
$env:DEBUT_STATUS_QA_FIXTURE_RUN_ID="qa352-YYYYMMDD-runN"
$env:DEBUT_STATUS_QA_FIXTURE_DRY_RUN="true"
npm.cmd run qa:debut-status-fixtures
```

Create the fixture rows only after the disposable owner is confirmed active:

```powershell
$env:DEBUT_STATUS_QA_FIXTURE_CONFIRM="CREATE_DEBUT_STATUS_OWNER_FIXTURES"
$env:DEBUT_STATUS_QA_USER_ID="<disposable QA owner user uuid>"
$env:DEBUT_STATUS_QA_FIXTURE_RUN_ID="qa352-YYYYMMDD-runN"
$env:DEBUT_STATUS_QA_TARGET_ENV="staging"
npm.cmd run qa:debut-status-fixtures
```

Production-like fixture creation is blocked unless the operator sets
`DEBUT_STATUS_QA_FIXTURE_ALLOW_PRODUCTION=true` for a one-time, approved,
live-safe QA owner run.

The script creates at most one fixture row per status for the selected
`runId`. It prints only row ids, statuses, the run id, and owner-only status
paths.

## QR1 Status Order

QR1 should sign in as the disposable owner through the private credential
channel, then check the three owner-only paths in this order:

1. `needs_more_info`:
   `GET /api/v1/me/debut-applications/<needs_more_info fixture id>/status`
2. `approved_for_contact`:
   `GET /api/v1/me/debut-applications/<approved_for_contact fixture id>/status`
3. `rejected`:
   `GET /api/v1/me/debut-applications/<rejected fixture id>/status`

Record only the non-secret path, status, fixture run id, result, and any stable
error code/messageKey. Do not paste session material.

## Automated Owner Projection Check

Run the verifier against fixture rows by owner plus run id:

```powershell
$env:DEBUT_STATUS_QA_VERIFY_CONFIRM="VERIFY_DEBUT_STATUS_OWNER_PROJECTION"
$env:DEBUT_STATUS_QA_USER_ID="<disposable QA owner user uuid>"
$env:DEBUT_STATUS_QA_FIXTURE_RUN_ID="qa352-YYYYMMDD-runN"
$env:DEBUT_STATUS_QA_TARGET_ENV="staging"
$env:DEBUT_STATUS_QA_API_BASE="<QA API origin>"
npm.cmd run qa:debut-status-owner-projection
```

If the row ids are already known, explicit id mode is also available:

```powershell
$env:DEBUT_STATUS_QA_VERIFY_CONFIRM="VERIFY_DEBUT_STATUS_OWNER_PROJECTION"
$env:DEBUT_STATUS_QA_NEEDS_MORE_INFO_ID="<fixture id>"
$env:DEBUT_STATUS_QA_APPROVED_FOR_CONTACT_ID="<fixture id>"
$env:DEBUT_STATUS_QA_REJECTED_ID="<fixture id>"
$env:DEBUT_STATUS_QA_TARGET_ENV="staging"
$env:DEBUT_STATUS_QA_API_BASE="<QA API origin>"
npm.cmd run qa:debut-status-owner-projection
```

The verifier signs a short-lived owner token locally, calls the owner-only
status endpoint, and prints sanitized checks only. It does not print the token,
cookie, password, owner UUID, email, DB URL, raw response body, or API origin.

Current `main` expects `needs_more_info` to expose only the resubmit CTA as a
safe owner-only mutation path. The verifier defaults
`DEBUT_STATUS_QA_EXPECT_NEEDS_MORE_INFO_CTA_ENABLED=true`. Set it to `false`
only when checking an older deployment before the resubmit contract. The
`approved_for_contact` and `rejected` fixtures must remain read-only.

## Expected Response Safety

Each fixture response should include:

- `readOnly=true`
- `ownerOnly=true`
- `application.status` mapped as:
  - `needs_more_info` -> `needs_more_info`
  - `approved_for_contact` -> `approved`
  - `rejected` -> `rejected`
- `application.materialSummary.metadataOnly=true`
- no contact values, intro, admin review note, internal metadata, private
  material URL, storage key, signed URL, token, cookie, password, or environment
  value
- no settlement, payout, wallet, Lumina, contract finalization, dispatch, or
  paid-like implication

`approved_for_contact` means contact-readiness only. It must not imply final
debut approval, contract completion, settlement eligibility, payout, or final
revenue share.

## Blocker Criteria

Report `BLOCKED` instead of running live mutation if:

- a disposable active owner cannot be prepared,
- QA credentials would need to be pasted into Notion/Git/chat,
- the target is production-like and no explicit live-safe approval exists,
- fixture creation would touch a real applicant/user,
- a required status row is missing after fixture creation,
- the owner-only endpoint leaks private material, admin notes, credentials,
  signed URLs, or paid-like state.
