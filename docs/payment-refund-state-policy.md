# Lumina Stage Payment And Refund State Policy

This document defines the backend state transition policy for Lumina purchase
payments and refund tracking. It is the operating contract for real PG provider
adapters.

## Payment Order States

| State | Meaning | Who can set it | Notes |
| --- | --- | --- | --- |
| `pending` | Payment order created, PG checkout not confirmed yet. | Server on order creation. | No Lumina credit. |
| `paid` | PG payment success was verified by webhook. | Payment webhook handler only. | Creates wallet credit exactly once. |
| `failed` | PG payment failed or non-paid terminal event arrived before paid. | Payment webhook handler. | No Lumina credit. |
| `cancelled` | PG payment was cancelled before paid. | Payment webhook handler. | No Lumina credit. |

## Payment Order Transition Rules

| From | Event | To | Allowed? | Side effects |
| --- | --- | --- | --- | --- |
| none | User creates payment order | `pending` | yes | Creates `payment_orders` row. |
| `pending` | Verified `paid` webhook | `paid` | yes | Creates `payment_transactions`, credits `wallet_accounts.cached_balance`, creates `wallet_ledger` purchase entry. |
| `failed` | Verified `paid` webhook | `paid` | yes | Allowed for PG recovery if failure arrived before success. Credits Lumina once. |
| `cancelled` | Verified `paid` webhook | `paid` | yes | Allowed for provider ordering issues. Credits Lumina once. |
| `pending` | Verified `failed` webhook | `failed` | yes | Creates `payment_transactions`; no wallet change. |
| `pending` | Verified `cancelled` webhook | `cancelled` | yes | Creates `payment_transactions`; no wallet change. |
| `failed` | Verified `cancelled` webhook | `cancelled` | yes | No wallet change. |
| `cancelled` | Verified `failed` webhook | `failed` | yes | No wallet change. |
| `paid` | Any non-paid webhook | `paid` | no | Treat as idempotent replay or late event; do not reverse Lumina here. |
| `paid` | Duplicate paid webhook | `paid` | no-op | Idempotent replay; no extra wallet credit. |

## Payment Webhook Invariants

- Webhooks must verify provider signatures before parsing trust decisions.
- Signature verification must use raw request body where the provider requires it.
- Webhook provider must match `payment_orders.provider`.
- Webhook amount must match `payment_orders.amount`.
- `payment_transactions` must be unique by `(provider, providerTransactionId)`.
- Lumina credit must only happen after the order row is atomically transitioned
  to `paid`.
- A paid order must never be credited twice.
- Client-side success pages never credit Lumina directly.

## Wallet Ledger Rules

Payment success creates one wallet ledger row:

- `direction`: `credit`
- `ledgerType`: `purchase`
- `referenceType`: `payment_order`
- `referenceId`: `payment_orders.id`
- `idempotencyKey`: `payment:{provider}:{providerTransactionId}`

The ledger row and `wallet_accounts.cached_balance` increment must happen in
the same database transaction.

## Refund Transaction States

| State | Meaning | Who can set it | Notes |
| --- | --- | --- | --- |
| `requested` | Operator has created a refund tracking request. | Admin API. | Does not call PG yet. |
| `processing` | Refund has been sent to PG or is being manually processed. | Admin API or future PG adapter. | Reserved amount still counts against refundable amount. |
| `succeeded` | Refund succeeded at PG/manual settlement layer. | Admin API or future PG adapter. | Future wallet reversal policy required. |
| `failed` | Refund failed. | Admin API or future PG adapter. | Does not count against refundable amount. |
| `cancelled` | Refund request was cancelled before completion. | Admin API. | Does not count against refundable amount. |

## Refund Transition Rules

| From | To | Allowed? | Notes |
| --- | --- | --- | --- |
| none | `requested` | yes | Only paid payment orders can create refunds. |
| `requested` | `processing` | yes | Use when PG refund request starts. |
| `requested` | `cancelled` | yes | Operator cancellation. |
| `requested` | `failed` | yes | Validation/manual failure. |
| `processing` | `succeeded` | yes | PG/manual refund completed. |
| `processing` | `failed` | yes | PG/manual refund failed. |
| `processing` | `cancelled` | yes | Only if PG/manual process can be cancelled. |
| `failed` | `requested` | yes | Retry by reopening request. Must pass refundable amount check. |
| `cancelled` | `requested` | yes | Reopen. Must pass refundable amount check. |
| `succeeded` | any other state | no | Succeeded refunds should be immutable except future correction workflow. |

## Refund Amount Rules

- Refunds can only be created for `paid` payment orders.
- Requested refund amount defaults to the full remaining refundable amount.
- Refund amount must be greater than zero.
- Refund amount must not exceed remaining refundable amount.
- `requested`, `processing`, and `succeeded` refunds count against remaining
  refundable amount.
- `failed` and `cancelled` refunds do not count against remaining refundable
  amount.
- Updating a failed/cancelled refund back to an active state must re-check
  over-refund risk.

## Current Limitation

The current admin refund APIs are tracking APIs only. They do not yet:

- call a PG refund endpoint,
- debit or reverse Lumina from the user wallet,
- create a negative wallet ledger entry,
- enforce immutable `succeeded` refund transitions in code.

These should be implemented when the production PG provider is selected and the
business refund policy is finalized.
