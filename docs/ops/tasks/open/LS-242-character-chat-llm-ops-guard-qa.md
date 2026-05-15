# LS-242 - Character Chat LLM Ops Guard QA

Owner: QR
Status: QA waiting
Priority: P0
Notion: #242

## Goal

Verify the basic character-chat LLM operating guard before treating GPT-backed
DM generation as safe for the first open.

## Current Evidence

- Basic DM generation now uses preflight before provider generation.
- Default free DM guard uses 30 second cooldown and KST service-day limits.
- Daily user provider request limit is 50.
- Provider daily failure limit is 5.
- Provider/model/token/cost metadata is recorded on generated messages.
- Wallet/order/settlement mutation is not part of the basic DM flow.
- Latest code-level regression test passed.

## Test Baseline

```text
command: npm.cmd test -- auth.service.spec.ts auth-email-delivery.service.spec.ts chat.service.spec.ts --runInBand
result: PASS, 3 suites / 35 tests
```

## QA Scope

- `GET /api/v1/chat/usage-summary`
- `GET /api/v1/chat/provider-ops-status`
- `POST /api/v1/chat/sessions/:sessionId/preflight`
- `POST /api/v1/chat/sessions/:sessionId/generate`

## QA Checklist

- Use a safe logged-in test account.
- Confirm usage summary is read-only and does not mutate wallet/order data.
- Confirm provider ops status does not expose secrets or provider raw response.
- Confirm preflight returns limit information.
- Confirm a quick repeat request hits cooldown.
- Confirm daily-limit behavior from code/test evidence; do not create excessive
  live calls just to exhaust a quota.
- Confirm generated-message responses do not expose API keys, auth tokens,
  cookies, raw provider payloads, or passwords.

## Do Not

- Do not run 50+ live generations to force a daily limit.
- Do not trigger paid wallet/order/settlement flows for this task.
- Do not record model provider secrets, prompts containing private data, raw
  provider responses, or auth tokens.

## Completion Report

Write the outcome in the Notion #242 page and keep the current-work row short:

```text
status:
task: #242
owner: QR
environment:
usage_summary:
provider_ops_status:
preflight:
cooldown_check:
mutation_check:
sensitive_value_check:
blocked_by:
next_needed:
sensitive_values_written: none
```

