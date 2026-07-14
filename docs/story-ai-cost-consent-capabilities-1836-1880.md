# Story AI cost, consent, and release capabilities

## Scope

- #1836 keeps the authenticated final-intake staging smoke in a private Render shell. Preflight reports only configuration booleans, a run ID, the public API path, and status.
- #1842 stores provider/model rates as versioned operational data and calculates retail price separately from entitlement and AI allowance.
- #1845 records request and terminal usage events against the rate-card version used by the session. Failed or timed-out work releases the reservation without consuming allowance.
- #1863 estimates part, act, volume, and work memory windows from the current part plus bounded evidence. It never marks the full manuscript as an every-step input.
- #1864 limits style memory to a rights-confirmed, work-scoped consent. Withdrawal immediately blocks retrieval and new AI continuation; deletion remains auditable.
- #1879 queues paid custom choices only after entitlement, release capability, moderation, active consent, cost ceiling, duplicate-choice, and allowance checks.
- #1880 stores fixed-choice, custom-choice, reset, and AI budget policy per immutable release and pins the rate-card version when a reader session starts.

## Private staging intake

Run preflight in the deployed server directory:

```powershell
$env:STORY_UPLOAD_STAGING_MODE='preflight'
npm.cmd run qa:story-upload-intake-staging
```

If status is `blocked_private_session_required`, open a private Render shell for the staging service, supply the already-managed staging origin and approved QA session through its secret environment, unset preflight mode, and run the same command. Do not paste those values into the board, chat, logs, or Git.

Record only `runId`, `publicPath`, `status`, check booleans, and whether the synthetic mutation ran. The controlled smoke creates one synthetic final submission, verifies an idempotent replay, and verifies extension and size rejection. It does not upload production manuscript content.

## Safety boundaries

- Reader responses omit provider payload, internal cost, prompt/context text, credentials, and private custom input.
- Usage ledgers preserve measured non-secret provider/model/rate version and token/cache/image counts.
- Existing routes, author endings, replay, and purchased manuscript access do not consume AI allowance.
- Capability or consent mismatch fails custom choice and reset controls closed; it does not revoke entitlement or ending history.
