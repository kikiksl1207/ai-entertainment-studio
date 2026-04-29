# Lumina Stage Admin Permission Matrix

This document defines the current admin role and route permission rules for
Lumina Stage backend operations.

## Permission Rules

- `*` allows every admin operation.
- Exact permissions such as `payments:read` allow only that action.
- Resource wildcard permissions such as `assets:*` allow every action for that
  resource.
- A `resource:write` permission also allows `resource:read`.
- Admin access itself is checked first by `AdminAuthGuard`; route-level
  permission is checked second by `AdminPermissionGuard`.

## Seeded Roles

| Role | Permissions | Intended owner |
| --- | --- | --- |
| `super_admin` | `*` | Founder, lead backend/operator |
| `content_admin` | `assets:write`, `artists:write`, `shortforms:write`, `audit:read` | Character producer, AI visual operator, content manager |
| `commerce_admin` | `commerce:write`, `payments:read`, `audit:read` | Commerce/operator, CS/refund operator, business manager |

## Route Matrix

| Route group | Methods | Required permissions | Notes |
| --- | --- | --- | --- |
| Admin roles | `GET /admin-roles` | `*` | Super admin only. |
| Admin users | `GET/POST/PATCH /admin-users` | `*` | Super admin only. Used to create and manage operators. |
| Audit events | `GET /audit-events` | `audit:read` | Included in content and commerce roles for traceability. |
| Payment orders | `GET /payment-orders`, `GET /payment-orders/:orderId` | `payments:read` | Read-only payment investigation. |
| Refund lookup | `GET /refund-transactions` | `payments:read` | Read-only refund investigation. |
| Refund operations | `POST /payment-orders/:orderId/refunds`, `PATCH /refund-transactions/:refundId` | `commerce:write` | Creates or updates refund tracking records only. Actual PG refund execution is separate. |
| Assets read | `GET /assets`, `GET /assets/:assetId` | `assets:read` or `assets:write` | `assets:write` includes read access. |
| Assets write | `POST /assets`, upload intent, confirm upload, archive, restore | `assets:write` | Object storage and asset lifecycle operations. |
| Artists | `POST/PATCH /artists` | `artists:write` | Character profile operations. |
| Artist asset links | `POST/DELETE /artists/:artistId/assets...` | `artists:write` and `assets:write` | Requires both content ownership and asset ownership. |
| Shortforms | `POST/PATCH /shortforms` | `shortforms:write` | Shortform content operations. |
| Shortform asset links | `POST/DELETE /shortforms/:shortformId/assets...` | `shortforms:write` and `assets:write` | Requires both content ownership and asset ownership. |
| Lumina products | `POST/PATCH /lumina-products` | `commerce:write` | Paid product catalog operations. |
| Gift products | `POST/PATCH /gift-products` | `commerce:write` | Gift catalog operations. |
| Boost products/campaigns | `POST/PATCH /boost-*`, snapshot | `commerce:write` | Boost commerce and ranking operations. |
| Premium video products | `POST/PATCH /premium-video-products` | `commerce:write` | Premium content catalog operations. |
| Premium video asset links | `POST/DELETE /premium-video-products/:productId/assets...` | `commerce:write` and `assets:write` | Requires commerce and asset permissions. |
| Chat feature products | `POST/PATCH /chat-feature-products` | `commerce:write` | Paid chat feature catalog operations. |

## Recommended Future Roles

These roles are not seeded yet, but they are natural additions once the team
grows.

| Future role | Suggested permissions | Reason |
| --- | --- | --- |
| `asset_operator` | `assets:write`, `audit:read` | Uploads, confirms, archives, and restores media without editing commerce. |
| `artist_operator` | `artists:write`, `assets:read`, `audit:read` | Edits character profiles but cannot upload/archive assets. |
| `shortform_operator` | `shortforms:write`, `assets:read`, `audit:read` | Manages shortform metadata and selects existing assets. |
| `cs_operator` | `payments:read`, `audit:read` | Investigates payment/refund issues without creating refunds. |
| `refund_operator` | `payments:read`, `commerce:write`, `audit:read` | Can create/update refund tracking records. Use carefully because `commerce:write` is currently broad. |

## Hardening Notes

- Split `commerce:write` into narrower permissions before adding many operators:
  `products:write`, `boosts:write`, `premium_videos:write`, `refunds:write`,
  `chat_products:write`.
- Keep admin user management restricted to `super_admin`.
- Keep payment webhooks outside admin routes; they must rely on provider
  signature verification, not admin permissions.
- Continue writing `audit_events` for every admin mutation.
