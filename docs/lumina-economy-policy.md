# Lumina Economy Policy

This document is the backend source of truth for Lumina Stage's virtual currency policy.

## Currency Units

- Base currency: Lumina
- Base exchange rate: 1 Lumina = 10 KRW
- Large display alias: 1 Stella = 10,000 Lumina = 100,000 KRW equivalent
- Database rule: store balances, ledgers, prices, gifts, votes, and unlock progress in Lumina only.
- Stella is a display and planning unit only. Do not add a separate wallet currency unless the business later requires a real multi-currency system.

## Purchase Products

Initial seed products:

| SKU | User-facing product | Paid Lumina | Bonus Lumina | KRW |
| --- | --- | ---: | ---: | ---: |
| `LUMINA_1000` | Lumina 1,000 | 1,000 | 0 | 10,000 |
| `LUMINA_3300` | Lumina 3,000 + bonus 300 | 3,000 | 300 | 30,000 |
| `LUMINA_5800` | Lumina 5,000 + bonus 800 | 5,000 | 800 | 50,000 |
| `LUMINA_12000` | Lumina 10,000 + bonus 2,000 | 10,000 | 2,000 | 100,000 |

Old seed products `LUMINA_100`, `LUMINA_550`, and `LUMINA_1200` should be archived by seed.

## Starter Grants

- Signup bonus: 300 Lumina
- Referral reward for existing user: 500 Lumina
- Referral signup bonus for invited new user: 500 Lumina
- Daily attendance reward: 7-day promo cycle, total 150 Lumina
  - Day 1: 10 Lumina
  - Day 2: 10 Lumina
  - Day 3: 20 Lumina
  - Day 4: 20 Lumina
  - Day 5: 20 Lumina
  - Day 6: 20 Lumina
  - Day 7: 50 Lumina

Free promotional rewards are capped at 3,000 Lumina per user. The cap includes
signup bonus, referral rewards, daily attendance, identity verification,
birthday, achievement, quest, and profile-completion rewards. Paid Lumina
purchase bonuses use a separate paid-bonus cap and do not share this free promo
pool.

Signup bonus is granted at wallet creation time and must create both:

- `wallet_accounts.cached_balance = 300`
- `wallet_ledger` credit entry with `ledgerType = signup_bonus` and a `signup_bonus:*` idempotency key

Referral and daily attendance rewards must be implemented with dedicated anti-abuse records before launch. Required future controls:

- one referral reward per verified new account
- self-referral prevention
- device/IP/risk checks
- daily attendance unique key per user and service date
- wallet ledger idempotency keys for every reward

Implemented backend records:

- `user_referral_codes`: one active referral code per user
- `referral_rewards`: one granted referral reward per referred user
- `daily_attendance_rewards`: one attendance grant per user per Korea service date

Implemented reward APIs:

- `GET /api/v1/rewards/referral-code`
- `GET /api/v1/rewards/referrals`
- `POST /api/v1/rewards/daily-attendance`
- `GET /api/v1/rewards/daily-attendance/policy`
- `GET /api/v1/rewards/daily-attendance`

Daily attendance is a small promo activation reward, not creator-settlement
eligible revenue. The 7-day cycle repeats while the user keeps a consecutive
attendance streak. The server resets service dates on the Korea service day and
stores every grant with `ledgerType = daily_attendance`.

Email and social signup accept optional `referralCode`. If the code is valid, active, and owned by another active user, both users receive referral Lumina through wallet ledger credits.

## Gifts

Small instant gifts should remain low-friction:

| Gift | Type | Lumina |
| --- | --- | ---: |
| Heart | instant reaction | 10 |
| Spotlight | instant reaction | 50 |

Progressive unlock gifts are funding-style. Participation starts at 1,000 Lumina.

| Gift | Type | Minimum participation | Default target |
| --- | --- | ---: | ---: |
| Stage outfit unlock | progressive unlock | 1,000 Lumina | 10,000 Lumina |

Progressive unlocks should affect character outfits, items, images, or premium content only after the target is reached and an operator approves the resulting equipped state.

## Votes And Boosts

- Free likes can exist as daily participation.
- Free likes are not settlement eligible. They are ranking/fan-temperature
  signals only.
- Paid basic vote: 10 Lumina.
- Paid votes and boosts must create wallet ledger debits and artist boost events in the same transaction.
- Rankings must be derived from boost events or snapshots, never from mutable counters alone.
- Paid likes are settlement candidates only after creator-settlement events are
  implemented and marked eligible.

## Character Chat Paid Modes

Seeded paid modes:

| SKU | Mode | Lumina | Settlement |
| --- | --- | ---: | --- |
| `CHAT_DEEP_REPLY` | Deep reply | 2 | eligible |
| `CHAT_STORY_REPLY` | Story reply | 5 | eligible |
| `CHAT_PREMIUM_REPLY` | Premium reply | 10 | eligible |
| `CHAT_FANLETTER_30` | Fan letter | 30 | eligible |
| `CHAT_FANLETTER_50` | Fan letter | 50 | eligible |
| `CHAT_FANLETTER_100` | Fan letter | 100 | eligible |

Basic chat remains free and settlement excluded. Image and voice replies remain
draft until model cost and safety validation are complete.

Related plan: `docs/character-chat-backend-plan.md`.

## User-To-User Gifts

User-to-user gifts are planned but not part of the current API surface. They should be implemented as wallet transfer ledgers, not by directly editing user balances.

Implemented records:

- sender wallet debit ledger
- receiver wallet credit ledger
- transfer order row with status
- idempotency key

Implemented APIs:

- `POST /api/v1/user-gifts`
- `GET /api/v1/user-gifts/sent`
- `GET /api/v1/user-gifts/received`

Current rules:

- minimum transfer: 10 Lumina
- maximum transfer: 100,000 Lumina
- daily transfer count limit: 20 sends
- daily sent Lumina limit: 100,000 Lumina
- monthly sent Lumina limit: 1,000,000 Lumina
- self-send blocked
- sender and recipient must both have active wallets

Future controls:

- moderation and fraud metadata
- operator-configurable risk tiers

## Accounting Principles

- Never store a simple `users.lumina_balance`.
- Every currency change must have a `wallet_ledger` row.
- Cached wallet balance is an optimization and must be consistent with ledger writes.
- Client success screens must not credit Lumina. Purchases are credited only from verified payment webhook events.
- Grants, referrals, attendance, gifts, boosts, premium unlocks, and refunds must use idempotency keys.
