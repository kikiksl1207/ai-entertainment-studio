# Creator Revenue and Settlement Spec

Updated: 2026-05-03

## Purpose

Lumina Stage needs creator settlement to be visible, predictable, and auditable.
Creators should be able to see an estimated payout, and admins should be able to
review, adjust, confirm, and mark payouts as paid without relying on manual
spreadsheets.

This document covers the MVP business model and the backend settlement structure
for:

- paid character chat modes
- fan letters and special replies
- paid votes / Lumina boosts
- future image or voice replies

Original Lumina-owned AI characters are platform-owned revenue. External creators,
AI debut artists, and strategic partners use the settlement flow below.

## Pricing Draft

`1L = 10 KRW`.

| Product | Lumina | KRW | Settlement |
| --- | ---: | ---: | --- |
| Basic character chat | 0L | 0 | excluded |
| Deep reply | 2L | 20 | eligible |
| Story reply | 5L | 50 | core creator product |
| Premium story | 10L | 100 | core creator product |
| Fan letter | 30L / 50L / 100L | 300 / 500 / 1,000 | core creator product |
| Paid vote / Lumina boost | 10L | 100 | eligible, with event-pool option |
| Image / voice reply | 20L+ | 200+ | later, after model-cost validation |

The product price should not be lowered for large creators. Instead, Lumina Stage
can lower the platform margin through a strategic partner settlement rate.

## Model Routing Draft

| Mode | Recommended Model | Notes |
| --- | --- | --- |
| Basic free chat | `gpt-5-nano` or equivalent low-cost model | short answer, no settlement |
| Deep reply | `gpt-4.1-mini` | emotional response, limited output |
| Story reply | `gpt-4.1-mini` | roleplay / scene response |
| Premium story | `gpt-5-mini` only when needed | higher price, stricter limits |

Do not use flagship models for always-on free chat unless a specific promotion or
enterprise deal covers the cost.

## Settlement Eligibility

Eligible:

- Lumina spent on paid character chat modes
- Lumina spent on fan letters / special replies
- Lumina spent on paid votes / Lumina boosts
- Lumina spent on future paid creator media interactions
- promotional / free Lumina spent on paid creator products. This is treated as
  Lumina Stage marketing cost, not as a reason to reduce the creator payout.

Excluded:

- free basic chat
- refunded, cancelled, or charged-back payments
- admin-granted internal test currency when explicitly marked as non-settlement
- content that is blocked, deleted for policy violation, or under payout hold

## Settlement Formula

Settlement is based on eligible paid-product Lumina usage. Do not split the
creator-facing payout by whether the user originally received the Lumina through
a paid purchase or a free promotion. Promotional Lumina is a platform marketing
cost.

Recommended calculation:

```txt
eligible Lumina usage KRW
- VAT component
- PG fee
- PG fee VAT
- refund / cancellation / chargeback adjustment
- AI generation cost
- direct server / storage cost where applicable
= settlement net revenue

creator payout = settlement net revenue * creator settlement rate
platform margin = settlement net revenue * platform margin rate
risk reserve = settlement net revenue - creator payout - platform margin
```

MVP default assumptions:

- VAT rate: 10%
- PG fee rate: 2.5%
- PG fee VAT: 10% of PG fee
- platform minimum margin for strategic creators: 10%
- strategic creator payout rate: up to 80% of settlement net revenue
- risk reserve: remaining share after creator payout and platform margin

Example, fan letter `30L = 300 KRW`:

```txt
gross usage: 300 KRW
VAT-excluded revenue: about 272.7 KRW
PG fee including VAT: about 8.25 KRW
AI / processing cost estimate: 5-20 KRW
settlement net revenue: about 244-259 KRW
creator payout at 80%: about 195-207 KRW
```

## Creator Tiers

| Tier | Use Case | Suggested Rate |
| --- | --- | ---: |
| Lumina-owned original AI | platform-owned | 0% external payout |
| Appearance-only AI debut | creator provides likeness only | 20-30% |
| Voice / song participation | likeness + voice or vocal contribution | 30-40% |
| Co-planning / operations | concept or ongoing fandom participation | 40-50% |
| Creator production partner | creator provides images/video/story operations | 50-60% |
| IP / agency partner | strong external IP or management partner | 60-70% |
| Strategic anchor creator | large audience acquisition partner | up to 80% |

Strategic creator terms should be time-limited, e.g. 3-6 months, and renegotiated
after launch data is available.

## Required Backend Structure

### 1. Promotional Cost Attribution

The creator-facing settlement should not show paid/free separation. However,
finance and operations still need to know how much payout came from promotional
Lumina so the platform can treat it as marketing cost.

Recommended approach:

- each spend ledger should record:
  - total spent Lumina
  - settlement eligible Lumina
  - optional promotional cost Lumina for internal reporting
  - optional non-settlement test Lumina
- creator payout uses settlement eligible Lumina.
- promotional cost is reported internally as user acquisition / marketing cost.
- user and creator UI should not reduce payout because a user spent free Lumina.

### 2. Creator Revenue Event

Every eligible paid action should write a normalized revenue event.

Suggested fields:

```txt
id
eventType
sourceType
sourceId
userId
artistId
creatorUserId
walletLedgerId
paymentOrderId
grossLumina
settlementEligibleLumina
promotionalCostLumina
nonSettlementLumina
unitPriceKrw
grossRevenueKrw
vatExcludedRevenueKrw
pgFeeKrw
pgFeeVatKrw
aiCostKrw
directCostKrw
netRevenueKrw
settlementRateBps
creatorShareKrw
platformShareKrw
riskReserveKrw
status
occurredAt
settlementPeriod
metadata
```

`eventType` candidates:

- `chat_deep_reply`
- `chat_story_reply`
- `chat_premium_story`
- `fan_letter`
- `paid_vote`
- `image_reply`
- `voice_reply`

### 3. Creator Settlement Period

Monthly summary per creator / artist.

Suggested fields:

```txt
id
creatorUserId
artistId
period
status
grossRevenueKrw
netRevenueKrw
creatorShareKrw
platformShareKrw
riskReserveKrw
eventCount
confirmedAt
paidAt
holdReason
adminNote
metadata
```

Status:

- `draft`
- `pending_review`
- `confirmed`
- `paid`
- `held`
- `cancelled`

### 4. Settlement Policy

PG fee and settlement settings must be editable by admin, not hardcoded forever.

Suggested fields:

```txt
id
name
status
vatRateBps
pgFeeRateBps
pgFeeVatRateBps
defaultSettlementRateBps
platformMinimumMarginBps
riskReserveBps
aiCostPolicy
effectiveFrom
effectiveTo
metadata
```

## Creator-Facing API Draft

```http
GET /api/v1/me/creator/settlements/current
GET /api/v1/me/creator/settlements?take=20
GET /api/v1/me/creator/revenue-events?period=2026-05&take=50
Authorization: Bearer <accessToken>
```

Current estimate response:

```json
{
  "period": "2026-05",
  "status": "draft",
  "estimatedPayoutKrw": "207000",
  "currency": "KRW",
  "eventCount": 1240,
  "summary": {
    "grossRevenueKrw": "360000",
    "netRevenueKrw": "258750",
    "creatorShareKrw": "207000",
    "platformShareKrw": "25875",
    "riskReserveKrw": "25875"
  },
  "productBreakdown": [
    {
      "eventType": "fan_letter",
      "eventCount": 900,
      "grossRevenueKrw": "270000",
      "creatorShareKrw": "156000"
    }
  ],
  "deductions": {
    "vatKrw": "27273",
    "pgFeeKrw": "7500",
    "pgFeeVatKrw": "750",
    "aiCostKrw": "12000",
    "refundAdjustmentKrw": "0"
  },
  "notice": "This is an estimated payout. Final payout may change after refunds, policy review, and admin confirmation."
}
```

## Admin API Draft

```http
GET /admin/api/v1/creator-settlements?period=2026-05
GET /admin/api/v1/creator-settlements/:settlementId
POST /admin/api/v1/creator-settlements/rebuild
PATCH /admin/api/v1/creator-settlements/:settlementId
POST /admin/api/v1/creator-settlements/:settlementId/confirm
POST /admin/api/v1/creator-settlements/:settlementId/mark-paid
GET /admin/api/v1/creator-revenue-events?period=2026-05&creatorUserId=...
```

Admin operations must write audit events.

## Admin UI Requirements

Admin should see:

- creator name / artist name
- current estimated payout
- settlement rate
- gross eligible Lumina usage
- promotional cost Lumina for internal marketing-cost reporting
- non-settlement test / blocked usage
- VAT / PG fee / PG fee VAT
- AI cost
- refund / cancellation adjustment
- net revenue
- creator payout
- platform margin
- risk reserve
- status
- hold reason
- payout memo

Admin actions:

- rebuild monthly draft
- hold payout
- release hold
- adjust line
- confirm
- mark as paid
- export CSV

## MVP Implementation Order

1. Document policy and pricing.
2. Add wallet paid/bonus spend attribution.
3. Add `creator_revenue_events`.
4. Record events from paid votes and chat feature orders.
5. Add creator current-estimate API.
6. Add admin settlement review API.
7. Add monthly settlement finalize/paid workflow.
8. Add CSV export and tax/accounting handoff.

Do not promise exact payout until steps 2-6 are complete.
