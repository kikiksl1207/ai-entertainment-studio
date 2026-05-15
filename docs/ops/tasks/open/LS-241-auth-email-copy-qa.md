# LS-241 - Auth Email And Reset Copy QA

Owner: QR
Status: QA waiting
Priority: P0
Notion: #241

## Goal

Confirm the real email and auth landing-page copy for email verification and
password reset after the Korean/KST template work.

## Current Evidence

- Backend email templates are implemented in Korean.
- Expiry time is generated in a human-readable KST format.
- `/verify-email` and `/reset-password` routes no longer return 404.
- Code-level tests already passed on `main`.

## QA Scope

- Email verification email subject and body.
- Password reset email subject and body.
- Button copy in both emails.
- KST expiry copy in both emails.
- `/verify-email` landing state copy.
- `/reset-password` landing and save-flow copy.

## QA Checklist

- Use a fresh unverified email/password test account.
- Request email verification.
- Confirm the email subject and body are Korean and match Lumina Stage tone.
- Confirm expiry text is KST and easy to read.
- Click the verification link and confirm the success/invalid/expired state UI
  where applicable.
- Request password reset for a valid email/password account.
- Open the reset link and save a new password.
- Confirm the reset success state appears and login works with the new password.

## Do Not

- Do not paste raw email links or tokens into Notion, Markdown, Git, or chat.
- Do not record passwords.
- Do not rely on an already verified or social-only account for final PASS.
- Do not mark complete from neutral API `accepted` alone; real inbox copy must
  be checked.

## Completion Report

Write the outcome in the Notion #241 page and keep the current-work row short:

```text
status:
task: #241
owner: QR
environment:
tested_account_type:
verified_email_copy:
reset_email_copy:
landing_pages:
screenshots_or_notes:
blocked_by:
next_needed:
sensitive_values_written: none
```

