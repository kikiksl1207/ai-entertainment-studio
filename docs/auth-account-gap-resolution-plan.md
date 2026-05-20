# Auth And Account Remaining Gap Resolution Plan

Updated: 2026-05-20
Owner: Kaido
Tasks: Notion #344, #347

This plan separates the remaining auth/account gaps after the email, password,
social-provider, and identity-skeleton backend contracts were merged. It does
not store credentials and does not enable external NICE/i-PIN/mobile identity
providers.

## Immediate Backend State

- Email/password signup, login, password reset, logout, invalid-token 401, and
  `/me` projections are implemented.
- `/me.emailVerification` exposes whether email verification is required and
  whether the account is verified.
- Social-only accounts are represented by `/me.hasPassword=false` and
  `/me.isSocialOnly=true`; password setup guidance is an account-management UI
  concern.
- Backstage QA admin authority is separated from normal and creator QA accounts.
- Debut submit remains an active logged-in-user flow. Email verification and
  NICE/i-PIN/mobile identity are visible signals but not hard gates for MVP,
  except that a verified minor identity is blocked.

## Gap Buckets

| Bucket | Items | Action |
| --- | --- | --- |
| Immediate / done | backend account-role contract, debut auth-account gates, stable adult/minor debut errors | Keep covered by tests and docs. |
| QA credential needed | verified email-password QA account, social-only QA account, safe credential path for QR live smoke | Prepare outside Notion/Git/chat; record only account type and pass/fail result. |
| External contract needed | real NICE mobile success callback, real i-PIN success callback, provider subject hash and signature verification | Keep excluded until provider contract/keys are available. |
| Product decision | whether email verification becomes a hard gate for debut submit | Current MVP keeps it visible but not blocking. |

## Safe Credential Handoff For #344

The next live QA should use two disposable/safe accounts:

1. Verified email-password QA account
   - `users.status=active`
   - email provider account exists
   - `emailVerified=true` or equivalent completed verification projection
   - has password
   - not a Backstage admin account
2. Social-only QA account
   - `users.status=active`
   - social provider account exists
   - `hasPassword=false`
   - `isSocialOnly=true`
   - not a Backstage admin account

The handoff channel must be private. Do not write raw email, password, token,
cookie, reset link, provider payload, DB URL, or env values in Notion, Git,
logs, or chat.

## QR Live ReQA Checklist

- Record `/health` commit.
- Verified email-password account:
  - login succeeds
  - `/api/v1/me` returns verified email state
  - mypage/security shows normal password management state
- Social-only account:
  - login succeeds through its safe provider/session path
  - `/api/v1/me` returns `hasPassword=false` and `isSocialOnly=true`
  - mypage/security shows password setup or social-only guidance, not reset-mail
    actions that imply an email-password account
- Session safety:
  - logout succeeds
  - protected `/me` and `/me/trust` return 401 after logout or invalid token
- Debut auth regression:
  - public debut policy is 200
  - unauth debut submit is 401
  - logged-in debut submit stays separate from wallet, settlement, payout, and
    Lumina flows

## Current Blocker For #344

#344 cannot be closed by code alone. The remaining acceptance depends on the
private QA credential source. If the credential source is unavailable, keep the
task blocked and do not ask the user to paste secrets into Notion or chat.
