# Auth QA Credential Source Runbook #344

Updated: 2026-05-20
Owner: Kaido
Task: Notion #344

This runbook closes the account-request ping-pong for QR1 by defining the
private credential slots and a sanitized verifier for verified email-password
and social-only account QA. It records only slot names, booleans, endpoint paths,
HTTP status, stable codes, and stable message keys.

Never write raw email, password, token, cookie, provider account credential,
provider token/code, DB URL, signed URL, or environment value in Git, Notion,
PRs, screenshots, logs, or chat.

## Required Private Slots

The canonical private credential source must include these additional #344
slots before QR1 live reQA:

| Slot | Purpose | Notes |
| --- | --- | --- |
| `QA_VERIFIED_EMAIL` | verified email-password QA account email | raw value stays private |
| `QA_VERIFIED_PASSWORD` | verified email-password QA account password | raw value stays private |
| `QA_SOCIAL_PROVIDER` | `google`, `kakao`, or `naver` | provider name only may be recorded |
| `QA_SOCIAL_EMAIL` | provider-owned social QA account email | raw value stays private |
| `QA_SOCIAL_PASSWORD` | provider-owned social QA account password | raw value stays private |

Optional API automation slots, when a secure provider token/code is already
available in the private source:

- `QA_SOCIAL_ACCESS_TOKEN`
- `QA_SOCIAL_AUTH_CODE`
- `QA_SOCIAL_REDIRECT_URI`

The optional API automation slots are not required for QR1 manual browser QA.
They must not be pasted into Notion/Git/chat.

## Expected Projections

Verified email-password account:

- `POST /api/v1/auth/login` succeeds.
- `GET /api/v1/me` returns:
  - `emailVerified=true`
  - `emailVerification.status="verified"`
  - `hasPassword=true`
  - `isSocialOnly=false`
- My Page security shows normal password management.
- It is not a Backstage admin account and is not the creator smoke account.

Social-only account:

- Login succeeds through the provider login surface or an approved secure
  session fixture.
- `GET /api/v1/me` returns:
  - `hasPassword=false`
  - `isSocialOnly=true`
- My Page security shows social-only/password setup guidance.
- It is not a Backstage admin account and is not the creator smoke account.

Regression checks that must remain true:

- `GET /api/v1/debut/policy` -> 200
- unauthenticated `POST /api/v1/debut/applications` -> 401
- invalid bearer `GET /api/v1/me` -> 401
- invalid bearer `GET /api/v1/me/trust` -> 401

## Sanitized Verifier

The server package exposes a value-safe verifier:

```powershell
cd server
$env:AUTH_QA_VERIFY_CONFIRM="VERIFY_AUTH_QA_CREDENTIAL_SOURCE"
$env:AUTH_QA_VERIFY_DRY_RUN="true"
npm.cmd run qa:auth-credential-source
```

Dry-run prints only which slot names are present or missing. It does not call
the API and does not print credential values.

Live verified-email account check:

```powershell
cd server
$env:AUTH_QA_VERIFY_CONFIRM="VERIFY_AUTH_QA_CREDENTIAL_SOURCE"
$env:AUTH_QA_API_BASE="<QA API origin>"
npm.cmd run qa:auth-credential-source
```

Live social API automation is skipped by default because provider login can
create or update provider-linked user state. If a secure provider token/code is
already present and the QA owner approves the API social login smoke, set:

```powershell
$env:AUTH_QA_ALLOW_SOCIAL_API_LOGIN="true"
```

The verifier output is sanitized. It may print:

- slot names present/missing,
- HTTP status,
- stable `code` / `messageKey`,
- `emailVerified`, `emailVerification.status`, `hasPassword`, `isSocialOnly`,
- provider kind from the allowlist only.

It must not print raw credentials, tokens, cookies, provider payloads, DB URLs,
signed URLs, reset links, or full response bodies.

## Current Source Check

The local private credential source observed during #344 contained the legacy
slot names only:

- `QA_USER_EMAIL`
- `QA_USER_PASSWORD`
- `QA_CREATOR_EMAIL`
- `QA_CREATOR_PASSWORD`
- `QA_ADMIN_EMAIL`
- `QA_ADMIN_PASSWORD`

It did not contain the required #344 verified or social-only slot names. Values
were not read into docs and were not recorded.

## QR1 ReQA Order

QR1 should proceed only after the private source dry-run reports all required
#344 slots present, or after an approved secure social session fixture is
prepared outside Git/Notion/chat.

1. Record `/health` commit.
2. Verified email-password account:
   - sign in through normal email login,
   - call `GET /api/v1/me`,
   - verify `emailVerified=true`, `emailVerification.status="verified"`,
     `hasPassword=true`, `isSocialOnly=false`,
   - verify My Page security normal password management state.
3. Social-only account:
   - sign in through the provider login surface or approved secure session
     fixture,
   - call `GET /api/v1/me`,
   - verify `hasPassword=false`, `isSocialOnly=true`,
   - verify My Page security social-only/password setup guidance.
4. Session safety:
   - logout,
   - verify protected `/me` and `/me/trust` return 401 after invalid token.
5. Debut auth regression:
   - public debut policy remains 200,
   - unauthenticated debut submit remains 401.

## Blocker Criteria

Keep #344 blocked instead of asking the user for secrets if:

- the private source lacks the required slot names,
- a social provider account cannot be used through a private channel,
- an approved secure session fixture is unavailable,
- any credential/token/cookie would need to be pasted into Notion/Git/chat,
- the candidate account is a real user, Backstage admin, or creator smoke
  account,
- `/me` does not match the expected projection.
