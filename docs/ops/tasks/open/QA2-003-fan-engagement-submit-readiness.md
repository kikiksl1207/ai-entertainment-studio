# QA2-003 - Fan Engagement Submit Readiness QA

Owner: Team2 QA
Status: open
Priority: P1

## Context

Home fan engagement teaser Phase 2 is read-only and passed QA. The next possible
step is enabling mission participation submit. Do not execute live mutations
unless safe test data and accounts are explicitly available.

## Read First

Read only:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- this task file

## Goal

Prepare the QA matrix and identify whether safe live submit QA can be performed.

## Check

- Is there a safe QA user account for mission submit?
- Is there a safe active mission that can be completed without affecting real
  users or production operations?
- Is there a way to reset or isolate the test participation reset bucket?
- Can QA verify duplicate submit behavior without polluting production data?
- Can QA verify idempotency replay safely?
- Can QA verify fan points without confusing them with Lumina wallet balance?
- Can QA verify logged-out behavior without mutation?
- Can QA verify mobile/narrow enabled CTA layout in a later Phase 3B build?

## Required Output

Write a readiness note to `docs/ops/inbox/team2-qa.md`.

Include:

- safe account/data availability
- proposed test matrix for Phase 3B
- blockers
- whether live mutation QA is possible or blocked
- explicit note that no mutation was executed in this readiness task unless
  Leader explicitly provided safe test data

## Do Not

- Do not run mission participation submit unless safe QA data is explicitly
  available.
- Do not run concept vote ballot submit.
- Do not alter wallet, settlement, payout, Lumina, or paid-like data.
- Do not record tokens, cookies, passwords, env values, or secret URLs.

## Suggested Phase 3B QA Matrix

- logged-out CTA -> auth modal, no API mutation
- logged-in first submit -> participation accepted
- duplicate submit same reset bucket -> stable already participated response
- idempotency replay same key/body -> safe replay
- mismatched replay if supported -> stable validation error
- fan point ledger is non-cash and does not change Lumina balance
- desktop/mobile/narrow layout for enabled CTA and result states

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.
