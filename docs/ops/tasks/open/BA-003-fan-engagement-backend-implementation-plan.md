# BA-003 - Fan Engagement Backend Implementation Plan

Owner: Builder A / Backend
Status: open
Priority: P1

## Context

BA-002 and BB-002 have been reconciled by Leader in:

- `docs/ops/fan-engagement-reconciled-contract.md`

This task is not backend implementation yet. It is the backend implementation plan that turns the reconciled contract into a safe sequence of schema/API/service work.

## Read First

Read only:

- `docs/ops/agents.md`
- `docs/ops/board.md`
- `docs/ops/fan-engagement-reconciled-contract.md`
- this task file

Then inspect only backend-relevant existing patterns:

- `server/prisma/schema.prisma`
- relevant existing `server/src/**` modules/controllers/services for community, creator studio, rewards, wallet, audit, auth, notifications

## Goal

Produce a backend implementation plan for the first fan engagement loop:

- one-tap missions
- concept votes
- fan one-line proposals
- AI reaction draft approval pipeline
- Creator Studio today tasks
- non-cash points, achievements, and public titles

## Required Output

Write the plan to `docs/ops/inbox/builder-a.md`.

Include:

- Proposed implementation phases, in order.
- Exact backend files/modules likely to be created or touched.
- Prisma model plan and index/unique constraint plan.
- Migration risk and rollback considerations.
- Endpoint implementation order using the reconciled canonical endpoints.
- Request validation and DTO shape plan.
- Auth/access control plan for public user, Creator Studio, and Backstage.
- Moderation gates for fan text and AI drafts.
- Idempotency strategy for missions, votes, proposals, and reward grants.
- Non-cash reward separation from `WalletAccount` / `WalletLedger`.
- i18n/stable copy key handling plan.
- Test plan: unit/service/e2e cases to add before implementation is considered safe.
- Explicit first implementation slice recommendation.

## Canonical Decisions To Preserve

- Mission list: `GET /api/v1/fan-engagement/missions?surface=&artistId=&scope=today&take=20`.
- Mission completion: `POST /api/v1/fan-engagement/missions/:missionId/participations`.
- Concept vote submit: `POST /api/v1/fan-engagement/concept-votes/:voteId/ballots`.
- MyPage reward summary: `GET /api/v1/me/fan-engagement/summary`.
- Creator Studio queue: `GET /api/v1/me/creator-studio/today-tasks`.
- Rewards are not Lumina, not KRW, not transferable, not settlement eligible.
- AI drafts never auto-publish.
- Fan text never becomes public before moderation approval.

## Do Not

- Do not implement code.
- Do not create a DB migration.
- Do not edit frontend files.
- Do not change the canonical endpoint names without writing a blocker.
- Do not introduce wallet, payout, settlement, trading, adult-brand, or revenue-sharing behavior.
- Do not record secrets, tokens, raw credentials, or production data.

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.

Required `tests` entry:

- `git diff --check`

If you only inspect and write docs, lint/build are not required.
