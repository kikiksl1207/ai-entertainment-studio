# Auth QA Account Access Handoff

Updated: 2026-05-20
Owner: Kaido
Task: Notion #339

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
