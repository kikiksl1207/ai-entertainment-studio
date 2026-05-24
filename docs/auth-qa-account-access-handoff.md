# Auth QA Account Access Handoff

Updated: 2026-05-24
Owner: Kaido
Task: Notion #339, #458

Update for #344: verified email-password and social-only QA now have a
dedicated private-source runbook in `docs/auth-qa-credential-source-344.md`.
Use that document before sending QR1 back to live account/security QA.

Update for #458: QA creator/admin permission ping-pong is now covered by the
sanitized self-check script `npm run qa:auth-access-self-check` from the
`server` directory.

This handoff separates the QA normal user, QA creator, and QA Backstage admin
accounts by backend authority. It records only roles, booleans, and runbook
steps. Do not write raw email, password, token, cookie, bearer value, DB URL, or
provider secret in Git, Notion, logs, or chat.

## Account Matrix

| QA account | Purpose | Required backend state | Backstage write | Creator Studio |
| --- | --- | --- | --- | --- |
| `QA_USER` | Normal logged-in live smoke | `users.status=active` and at least one `user_auth_accounts` row | No | No |
| `QA_CREATOR` | Creator Studio live smoke | `users.status=active` plus active `artist_operators` row | No | Yes |
| `QA_ADMIN` | Backstage write/admin live smoke | `users.status=active`, active `admin_users`, role `super_admin`, permissions `*` | Yes | No |

`QA_ADMIN` must not be reused as the normal user or creator smoke account. The
Backstage admin account can read/write high-risk operations, so it belongs in a
separate secure credential channel.

## Authority Checks

- Normal user authority is `users.status` plus `user_auth_accounts`.
- Creator authority is active `artist_operators` returned through
  `GET /api/v1/me/trust` and Creator Studio bootstrap.
- Backstage authority is `AdminAuthGuard` followed by `AdminPermissionGuard`.
- `AdminAuthGuard` accepts active `admin_users` rows and a bootstrap
  `ADMIN_EMAILS` fallback. For repeatable QA, prefer a DB-backed `admin_users`
  row over relying on env fallback.
- `AdminPermissionGuard` allows `*`, exact permissions, `resource:*`, and
  `resource:write` for `resource:read`.

## Safe Smoke Paths

Record only HTTP status, stable code/messageKey, role name, permission boolean,
and high-level result.

| Account | Safe checks |
| --- | --- |
| `QA_USER` | `POST /api/v1/auth/login`, `GET /api/v1/me`, `GET /api/v1/me/trust`, read-only browse/debut policy |
| `QA_CREATOR` | `POST /api/v1/auth/login`, `GET /api/v1/me`, `GET /api/v1/me/trust`, `GET /api/v1/me/creator-studio` |
| `QA_ADMIN` | `POST /api/v1/auth/login`, `GET /api/v1/admin/api/v1/me`, `GET /api/v1/admin/api/v1/backstage/summary`, admin user/role read checks |

## Creator/Admin Self-Check #458

Use this when QR needs to confirm whether the prepared QA creator/admin
accounts are blocked by credentials, authority rows, permissions, or backend
errors. The script records only safe values: slot names, HTTP status,
stable `code` / `messageKey`, access booleans, safe role kind, permission
booleans, and `nextOwner` routing keys.

Dry-run slot readiness:

```powershell
cd server
$env:AUTH_QA_ACCESS_VERIFY_CONFIRM="VERIFY_AUTH_QA_ACCESS_SELF_CHECK"
$env:AUTH_QA_ACCESS_VERIFY_DRY_RUN="true"
npm.cmd run qa:auth-access-self-check
```

Live Creator Studio / Backstage self-check:

```powershell
cd server
$env:AUTH_QA_ACCESS_VERIFY_CONFIRM="VERIFY_AUTH_QA_ACCESS_SELF_CHECK"
$env:AUTH_QA_ACCESS_API_BASE="<QA API origin>"
npm.cmd run qa:auth-access-self-check
```

Required private slots:

| Slot group | Private slots | Pass criteria |
| --- | --- | --- |
| `qa_creator` | `QA_CREATOR_EMAIL`, `QA_CREATOR_PASSWORD` | login succeeds, `/me` and `/me/trust` return 200, `GET /api/v1/me/creator-studio` returns 200, `creatorStudioAccessEnabled=true`, `artistOperatorAccess=true`, source `artist_operator` |
| `qa_admin` | `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD` | login succeeds, `GET /api/v1/admin/api/v1/me` returns 200, role kind `super_admin`, wildcard permission boolean true, `GET /api/v1/admin/api/v1/backstage/summary` returns 200 |

Do not paste the API origin value, raw credential values, access tokens,
refresh tokens, cookies, DB URLs, or raw response bodies into Git, Notion, PRs,
screenshots, logs, or chat.

Failure owner routing:

| `nextOwner` | Meaning |
| --- | --- |
| `private_credential_owner` | Required private slots are missing, or login fails without a server error. |
| `creator_access_owner` | `QA_CREATOR` can authenticate but lacks active artist-operator Creator Studio access. |
| `backstage_admin_owner` | `QA_ADMIN` can authenticate but lacks active Backstage admin authority or wildcard permission. |
| `backstage_permission_owner` | Admin identity exists but Backstage summary permission is denied. |
| `backend_owner` | A server/network/backend failure prevents the self-check from reaching a stable auth/permission result. |
| `none` | Self-check passed. |

## Missing Account Runbook

1. Prepare credentials in a private secure channel or local security file only.
2. Create or identify an active user. Do not paste the raw email/password into
   Git, Notion, or chat.
3. For `QA_CREATOR`, use an existing super-admin path to grant an active
   artist-operator row for the target artist, then verify only
   `artistOperatorAccess` booleans.
4. For `QA_ADMIN`, use an existing super-admin path to create or update an
   active admin user with the `super_admin` role and `*` permission.
5. Verify through `/me`, `/me/trust`, and `/admin/api/v1/me`. Record only
   provider kind, email verification status, role, permission boolean, and
   access enabled/disabled.

## Current Gap / Blocker Notes

- This work did not create live credentials because no safe credential channel
  was available in the repo/session.
- If any QA account is missing, the next operator should follow the runbook
  directly; the Leader/user should not be used as a token/password messenger.
- A final live smoke can be run by QR once the safe credential locations are
  confirmed privately.
