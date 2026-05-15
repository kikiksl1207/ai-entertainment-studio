# LS-238 - Auth Email And Password Reset Final QA

Owner: QR
Status: QA waiting
Priority: P0
Notion: #238

## Goal

Finish live QA for the email verification and password reset API flow without
recording raw links, tokens, or passwords.

## Current Evidence

- Backend action-token API skeleton is implemented.
- Resend domain and delivery path were verified.
- `/verify-email` and `/reset-password` routes return 200, not 404.
- Email verification real-link success screen was confirmed from user-provided
  result.
- Latest code-level regression test passed.

## PM Decision - 2026-05-15

- Chamo's code/API check is PASS.
- Do not use the user's personal email as the final PASS basis.
- Final PASS requires an inspectable fresh email/password QA inbox so QR can
  open a real password reset link, save a new password, and log in again.
- If no inspectable QA inbox or reset link is available, QR should report
  `BLOCKED` with `blocked_by: safe QA inbox/reset link needed`.
- Neutral provider `accepted` is not enough for completion because the reset
  save flow must be proven with a real link.

## Test Baseline

```text
command: npm.cmd test -- auth.service.spec.ts auth-email-delivery.service.spec.ts chat.service.spec.ts --runInBand
result: PASS, 3 suites / 35 tests
```

## QA Scope

- Request email verification with a fresh email/password test account.
- Open the verification link and confirm success state.
- Request password reset for a valid email/password account.
- Open the reset link, save a new password, and confirm login with the new
  password.
- Confirm no raw token, password, action URL, cookie, or debug value is exposed
  in UI, console, Notion, or reports.

## Acceptance Criteria

- Email verification request returns the expected neutral success response.
- Verification link reaches a real page and shows the correct state.
- Password reset request returns the expected neutral success response.
- Reset link reaches a real page and saves a new password.
- Old/current auth session behavior remains safe after reset.
- Token/password raw values are never recorded.

## Do Not

- Do not paste raw email links or token query strings.
- Do not record passwords or cookies.
- Do not mark complete using only provider `accepted`; the reset save flow must
  be checked with a real link.
- Do not use a social-only account for password reset completion QA.

## Completion Report

Write the outcome in the Notion #238 page and keep the current-work row short:

```text
status:
task: #238
owner: QR
environment:
tested_account_type:
verification_flow:
reset_request:
reset_save:
login_after_reset:
blocked_by:
next_needed:
sensitive_values_written: none
```
