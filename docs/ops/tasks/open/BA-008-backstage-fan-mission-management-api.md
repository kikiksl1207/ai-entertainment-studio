# BA-008 - Backstage Fan Mission Management API

Owner: Builder A / Backend
Status: open
Priority: P1

## Context

Fan engagement mission submit is blocked because QA has no safe active mission
to submit against.

Attempts to create a QA mission through the current session failed because there
is no DB/API execution path available. Waiting for raw DB access keeps the
Leader in the middle and does not scale. The product needs a minimal operator
path for creating and archiving fan missions.

## Goal

Add a small Backstage/admin backend API that lets a super-admin create, list,
and archive fan engagement missions. This unlocks QA-only missions now and
becomes the foundation for real mission operations later.

## Route Contract

Backstage frontend code should call the existing helper instead of hardcoding an
external path:

- list: `adminApiPath('/backstage/fan-engagement/missions')`
- create: `adminApiPath('/backstage/fan-engagement/missions')`
- archive/deactivate: `adminApiPath('/backstage/fan-engagement/missions/:missionId/archive')`

With the current production API host root (`https://api.lumina-stage.com`), this
resolves to:

- `GET /api/v1/admin/api/v1/backstage/fan-engagement/missions`
- `POST /api/v1/admin/api/v1/backstage/fan-engagement/missions`
- `POST /api/v1/admin/api/v1/backstage/fan-engagement/missions/:missionId/archive`

Do not use `/admin/api/v1/...` as a host-root external call example; it can
return 404 in the current deployment. If an API base URL already includes
`/api/v1`, the helper may emit `/admin/api/v1/...` relative to that base.

## Scope

Backend only.

Add minimal endpoints under the existing Backstage/admin authorization pattern.
Exact route naming may follow existing admin conventions, but the surface should
be clearly admin/backstage-only.

Required capability:

- list fan missions
- create fan mission
- archive/deactivate fan mission

Minimum fields for create:

- `slug`
- `missionType`
- `status`
- `surface` or `surfaces`
- `resetPolicy`
- `rewardPolicy`
- `copy`
- `startsAt`
- `endsAt`
- optional `artistId`
- optional `actionType`
- optional `actionTargetId`

Minimum QA mission support:

- can create a mission visible to
  `GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3`
- can use reset bucket like `season:qa-YYYYMMDD-runN`
- can use `rewardPolicy={"points":1}`
- can archive the QA mission after smoke

## Security / Permission

- Super-admin only, or the strictest existing Backstage admin permission pattern.
- Do not expose this API publicly.
- Do not accept or return secrets.
- Record enough audit metadata if an existing audit helper is available.
- Do not weaken existing admin auth or user auth.

## Fan Points Policy

Keep fan engagement isolated:

- no `WalletAccount`
- no `WalletLedger`
- no Lumina conversion
- no settlement/payout/revenue sharing
- no paid-like/boost coupling
- no trading/cash-like language

Response policy for mission rewards must remain non-cash:

- `cashLike: false`
- `luminaAmount: 0`
- `settlementEligible: false`
- `transferable: false`

## Not Allowed

- Do not enable frontend Home submit CTA.
- Do not implement concept vote ballot submit.
- Do not add Creator Studio today tasks.
- Do not add fan proposal submit.
- Do not add title equip.
- Do not add production auto seed data.
- Do not require the Leader to paste DB URLs, passwords, tokens, or cookies.
- Do not add broad Backstage redesign.

## Acceptance Criteria

- Super-admin can create one QA-only active mission.
- The created mission appears in the public read-only mission list for
  `surface=home&scope=today&take=3`.
- Super-admin can archive/deactivate that mission.
- Invalid inputs return stable `code` and `messageKey`.
- Duplicate slug is handled with a stable error.
- Lint/build pass.
- No frontend files are changed.
- No schema/migration unless strictly required. Existing `FanMission` fields
  should be enough.

## Suggested QA Flow After Merge

After BA-008 is merged and deployed:

1. Integrator/Backend creates a QA mission through the new admin API.
2. Record non-secret values only:
   - mission id
   - mission slug
   - reset bucket
   - API host
3. Open QA2-005 for logged-in mission submit smoke.
4. Keep frontend Phase 3B blocked until QA2-005 passes and the gate opens.

## Required Checks

- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

If Prisma schema changes are unexpectedly required:

- `npx.cmd prisma generate`
- explain why the existing `FanMission` model was insufficient

## Required Output

Write completion to `docs/ops/inbox/builder-a.md`.

Include:

- branch and commit
- endpoints added
- permission model
- sample non-secret request body for QA mission creation
- how to archive/deactivate the QA mission
- checks run
- whether QA2-005 can open after deploy

## Completion Note

Use the standard completion note from `docs/ops/agents.md`.
