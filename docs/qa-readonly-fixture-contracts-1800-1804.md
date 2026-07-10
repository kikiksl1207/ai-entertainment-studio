# QA Read-Only Fixture Contracts (#1800-#1804)

This source pack defines safe QA fixture contracts only. It does not create
accounts, read inboxes, mint sessions, call identity or payment providers, write
wallet ledgers, submit debut applications, submit story choices, or call AI
providers.

## Safe Output

- Record only `runId`, `fixtureStatus`, public path, scenario/status keys,
  HTTP status, locale copy keys, and safe boolean flags.
- Do not record raw email, password, token, cookie, API key, DB URL, raw user id,
  provider payload, reset link, wallet ledger id, payment transaction id, phone,
  identity token, private material URL, or raw author notes.

## Contracts

- #1800: `AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK`
- #1801: `EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT`
- #1802: `WALLET_READONLY_QA_FIXTURE_CONTRACT`
- #1803: `DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT`
- #1804: `STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT`

All five contracts are read-only/source-audit surfaces. QR can verify state keys
and public paths without needing credentials or secret-bearing fixture data.
