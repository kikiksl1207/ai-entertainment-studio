# Artist Roles And Moderation Backend Plan

Updated: 2026-05-03

This document fixes the backend direction for Notion task #100.
Lumina Stage needs three account types in practice: user, artist, and admin.
The current database already has `admin_users` and `artist_operators`; this plan
extends that model without forcing a flat `users.role` column.

## Role Model

Normal user:

- exists in `users`
- can browse, follow, post, like, vote, chat, and apply for debut

Artist:

- is a normal user with an active `artist_operators` row
- can write/edit content for the linked artist based on permissions
- should enter a 7-day watch period when first activated

Admin:

- is a normal user with an active `admin_users` row
- acts through `/admin/api/v1`
- has explicit permissions through `admin_roles.permissions`

This keeps identity flexible. A person can be both a user and artist operator,
or both admin and artist operator, without changing the base `users` table.

## Existing Tables

Already implemented:

- `users`
- `admin_users`
- `admin_roles`
- `artists`
- `artist_operators`
- `community_posts`
- `community_reports`
- `audit_events`

Existing `artist_operators.permissions` can hold:

- `artist:profile:write`
- `artist:feed:write`
- `artist:assets:write`
- `artist:stats:read`
- `artist:settlement:read`

## Artist Operator Metadata

For a durable implementation, add:

```txt
artist_operator_reviews
- id
- artist_operator_id
- review_mode: new_artist_watch / normal / caution / restricted
- watch_until
- status
- reason
- metadata
- created_at
- updated_at
```

If we choose a direct column migration later, add to `artist_operators`:

```txt
review_mode text default 'new_artist_watch'
watch_until timestamptz
moderation_note text
```

## Content Authorship

Community posts should distinguish author mode:

- normal user post
- artist operator post
- admin/system official artist post

Current fields:

- `community_posts.author_user_id`
- `community_posts.artist_id`
- `community_posts.post_type`
- `community_posts.metadata`

MVP metadata recommendation:

```json
{
  "authorMode": "artist_operator",
  "operatorRole": "owner",
  "operatorId": "<artist_operator_id>",
  "reviewMode": "new_artist_watch",
  "moderation": {
    "riskLevel": "normal",
    "matchedTypes": [],
    "requiresAdminReview": false
  }
}
```

Status values should remain compatible with existing `published`, `hidden`, and
soft-delete behavior. Future values may include `blocked`, `flagged`, and `draft`.

## Moderation Policy

Default publishing rule:

- immediate publish for normal content
- block hard-risk patterns before saving
- flag watch-risk patterns for admin review
- prioritize new artist content for 7 days

Hard block patterns:

- phone number
- email address
- bank account / deposit request
- open chat or external contact channel
- external payment or off-platform transaction
- illegal trading / adult solicitation
- raw personal information exposure

Watch/review patterns:

- excessive platform migration wording
- offline meeting hints
- brand or agency conflict-sensitive wording
- political/social issue content
- aggressive or harassment-like wording

Do not overbuild keyword lists before real data appears. Use a policy table or
config so operations can tune patterns after launch.

## API Draft

Existing admin artist operator endpoints:

```http
GET /admin/api/v1/artists/:artistId/operators
POST /admin/api/v1/artists/:artistId/operators
PATCH /admin/api/v1/artist-operators/:operatorId
```

Future artist self-service:

```http
GET /api/v1/me/artist-operator-profile
GET /api/v1/me/artist-dashboard
PATCH /api/v1/me/artists/:artistId/profile
POST /api/v1/me/artists/:artistId/feed-posts
```

Moderation:

```http
POST /api/v1/moderation/preview
GET /admin/api/v1/moderation/policies
POST /admin/api/v1/moderation/policies
PATCH /admin/api/v1/moderation/policies/:policyId
GET /admin/api/v1/moderation/queue?mode=new_artist_watch
POST /admin/api/v1/moderation/content/:contentId/hide
POST /admin/api/v1/moderation/content/:contentId/restore
POST /admin/api/v1/moderation/content/:contentId/request-edit
```

Hard block response draft:

```json
{
  "decision": "block",
  "riskLevel": "block",
  "matchedTypes": ["external_contact"],
  "userMessage": "외부 연락처나 개인 연락 수단은 공개 글에 포함할 수 없어요. 해당 부분을 수정해 주세요."
}
```

## Admin Dashboard Requirements

Admin screens should support:

- new artist 7-day watch queue
- flagged / blocked content queue
- report queue
- hidden / restored content history
- caution / restricted artist accounts
- moderation policy management
- audit log per action

Every admin action must create an `audit_events` row.

## Role Split

Chamo:

- operator permissions, watch mode, moderation status/API contracts
- hard-block vs watch-risk backend decision
- audit and admin action design

Cloud:

- artist dashboard and profile/feed composer
- admin moderation list screens
- inline block/warning UX

Emily:

- artist-facing safety copy
- admin moderation labels
- hard-block / warning / watch policy wording

