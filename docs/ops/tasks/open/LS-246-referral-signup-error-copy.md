# LS-246 - Referral Signup Error Copy

Owner: Zoro
Status: Deployment check waiting
Priority: P0
Notion: #246

## Goal

Verify that invalid referral code errors in the signup modal no longer show raw
English backend text and that the optional referral-code flow still lets users
continue when the field is empty.

## Current Evidence

- Implemented and pushed on `main`.
- Commit: `cbff81a fix: localize referral signup errors`
- Changed file: `app.js`
- `node --check app.js` passed.
- `git diff --check` passed.
- Local QR verification passed, but live frontend was stale.

## PM Decision - 2026-05-15

- This is not ready for completion while the live frontend is stale.
- Current owner is Zoro for deployment reflection check.
- After Zoro confirms the live bundle includes `cbff81a`, hand the task back
  to QR for real signup modal QA.
- Do not mark complete from local-only evidence.

## Expected User Copy

```text
추천인 코드가 올바르지 않아요. 코드를 확인하거나 비워두고 가입해 주세요.
```

## Deployment Check

- Confirm the live frontend bundle includes the `app.js` referral-copy change.
- Confirm no later frontend change reverted the signup modal error handling.
- If live is still stale, report `BLOCKED` with the deployment or cache reason.
- Do not ask the user to test until the deployed frontend is confirmed current.

## QA Scope

- Signup modal referral-code validation.
- Empty referral-code signup flow.
- Mobile width layout.
- No sensitive value logging.

## QA Checklist

- Open the signup modal.
- Enter an invalid referral code such as `TEST123`.
- Submit with otherwise valid signup fields.
- Confirm the expected Korean copy appears.
- Remove the referral code and submit again with a fresh test email.
- Confirm signup continues into the email-verification guidance flow.
- Check around 390px mobile width and confirm the error box wraps cleanly.
- Confirm console output does not include raw password, access token, refresh
  token, full user body, or raw referral code.

## Do Not

- Do not record passwords, tokens, cookies, or raw auth responses.
- Do not use a personal email in the markdown report.
- Do not mark complete if the text fits desktop but breaks on mobile.
- Do not mark complete from local-only evidence while live is stale.

## Completion Report

Write the outcome in the Notion #246 page and keep the current-work row short:

```text
status:
task: #246
owner: Zoro
environment:
deploy_reflection:
tested_flows:
mobile_width:
console_sensitive_check:
result:
blocked_by:
next_needed:
sensitive_values_written: none
```
