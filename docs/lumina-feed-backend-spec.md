# Lumina Feed Backend Spec

Updated: 2026-05-02

## Product Split

Lumina Stage now separates the fan surfaces like this:

- Lumina Pick: vote, ranking, monthly main pick, hall of fame.
- Lumina Feed: X-style timeline for artists, AI artists, and fans.
- Shortform: video, performance, challenge, teaser, and clips.

The feed is not an adult-content surface. The Korean MVP keeps adult content out of
Lumina Stage. Any future adult-oriented product must be separated by policy, domain,
age verification, payment, moderation, and operations.

## User Types

The backend keeps user identity flexible instead of storing one flat role on `users`.

- General user: normal fan account.
- Artist operator: a user with active `artist_operators` access to one or more artists.
- Admin: existing `admin_users` access.

This allows one user to operate multiple AI artists later.

## Database Models

Added in migration `0011_lumina_feed_community`:

- `artist_operators`
- `community_posts`
- `community_replies`
- `community_reactions`
- `community_reports`
- `artist_follows`

Added in migration `0015_community_hide_blocks`:

- `community_hidden_posts`
- `user_blocks`

Added in migration `0016_user_notifications`:

- `user_notifications`

Added in migration `0017_community_post_assets`:

- `community_post_assets`

## Public/Frontend APIs

### Feed

```http
GET /lumina-feed?mode=all&take=20
GET /lumina-feed?mode=artists&take=20
GET /lumina-feed?mode=fans&take=20
GET /lumina-feed?artistSlug=yoon-serin
GET /me/lumina-feed?mode=all&take=20
GET /me/lumina-feed?mode=following&take=20
GET /lumina-feed/samples?mode=all&take=20
GET /artists/:slug/posts
```

`mode` values:

- `all`
- `artists`
- `fans`

Sample `mode` also accepts `debut` for debut applicant style posts.

`GET /me/lumina-feed` requires user auth and keeps the public feed shape. It
filters out posts hidden by the current user and posts authored by users in an
active block relationship.
It also accepts `mode=following`, which returns posts from followed artists and
followed normal users. If the viewer follows nobody, it returns `[]`.

Response is an array of posts:

```json
[
  {
    "id": "post-uuid",
    "authorUserId": "user-uuid",
    "artistId": "artist-uuid",
    "postType": "artist_post",
    "status": "published",
    "visibility": "public",
    "body": "오늘 무대 뒤에서 만난 빛을 남겨둘게요.",
    "likeCount": 12,
    "replyCount": 3,
    "reportCount": 0,
    "publishedAt": "2026-05-02T00:00:00.000Z",
    "author": {
      "id": "user-uuid",
      "email": "artist@example.com",
      "profile": {
        "displayName": "Seojin Operator",
        "avatarAssetId": null
      }
    },
    "artist": {
      "id": "artist-uuid",
      "slug": "choi-seojin",
      "displayName": "최서진"
    }
  }
]
```

### Sample Posts

```http
GET /lumina-feed/samples?mode=all&take=20
GET /lumina-feed/samples?mode=artists&artistSlug=choi-seojin
GET /lumina-feed/samples?mode=debut
```

This endpoint exposes the 30 sample posts created in Notion task #019. It does
not read or write the database. Use it only as a frontend empty-state, fallback,
or prototype source while the real feed has little content.

Response:

```json
{
  "source": "notion_019_sample_posts",
  "total": 30,
  "items": [
    {
      "id": "sample-001",
      "postType": "artist_post",
      "artistSlug": "yoon-serin",
      "authorType": "ai_artist",
      "body": "리허설이 끝났습니다. 조명이 꺼진 뒤에도 남는 시선이 있다면, 오늘의 무대는 성공에 가까웠다고 생각해요.",
      "intention": "윤세린의 절제된 무대 후 감정",
      "frontendNote": "아티스트 공식 피드 예시"
    }
  ]
}
```

Query:

- `mode`: `all`, `artists`, `fans`, or `debut`. Default `all`.
- `artistSlug`: optional artist filter.
- `take`: 1-50. Default 20.

### Create/Delete Post

```http
POST /lumina-feed/posts
DELETE /lumina-feed/posts/:postId
Authorization: Bearer <accessToken>
```

Fan post:

```json
{
  "body": "오늘 최서진 무드 너무 좋다."
}
```

Artist post:

```json
{
  "artistSlug": "choi-seojin",
  "body": "무대는 끝나도 시선은 오래 남아.",
  "visibility": "public"
}
```

If `artistId` or `artistSlug` is provided, the backend requires an active
`artist_operators` row for the current user and artist.
`DELETE /lumina-feed/posts/:postId` soft-deletes the current user's own post
and returns `{ "ok": true }`. Artist operators can also delete posts for artists
they operate. It does not hard-delete content.

Body rules:

- `body`: 1-500 characters.
- `visibility`: `public` or `followers`, default `public`.
- MVP only exposes `public` feed. `followers` is reserved for later UI/policy work.
- `assetIds`: optional array of 0-4 unique public image asset UUIDs. Assets must
  already be uploaded/confirmed and cannot be archived, private, pending, or
  non-image.

Linked images appear on post responses as `assets[]` with public `url` and
`thumbnailUrl`. Internal `storageKey`, provider data, and raw asset metadata are
not exposed on the feed response.

### Replies

```http
GET /lumina-feed/posts/:postId/replies
POST /lumina-feed/posts/:postId/replies
DELETE /lumina-feed/replies/:replyId
Authorization: Bearer <accessToken>
```

Body:

```json
{
  "body": "이 말투 너무 최서진 같다."
}
```

Reply body is 1-300 characters.
`DELETE /lumina-feed/replies/:replyId` soft-deletes the current user's own reply
and returns `{ "ok": true }`. Artist operators can also delete replies on their
operated artist posts.

### Likes

```http
POST /lumina-feed/posts/:postId/like
DELETE /lumina-feed/posts/:postId/like
Authorization: Bearer <accessToken>
```

Like is idempotent. If the same user already liked the post, the backend returns
`idempotentReplay: true`.

### Notifications

```http
GET /me/notifications?status=all&take=20
GET /me/notifications/unread-count
PATCH /me/notifications/:notificationId/read
PATCH /me/notifications/read-all
Authorization: Bearer <accessToken>
```

Current event triggers:

- `feed.reply`: another user replies to the user's post.
- `feed.like`: another user likes the user's post for the first time.
- `user.follow`: another user follows or re-follows the user.

Self-actions are ignored. User settings control delivery:
`feedNotifications=false` suppresses `feed.*`, and
`activityNotifications=false` suppresses `user.follow`.

### Reports

```http
POST /lumina-feed/posts/:postId/report
Authorization: Bearer <accessToken>
```

Body:

```json
{
  "reason": "spam",
  "detail": "Repeated promotional content"
}
```

Allowed reasons:

- `sexual_content`
- `harassment`
- `hate`
- `impersonation`
- `spam`
- `other`

### User Hide/Block

```http
POST /lumina-feed/posts/:postId/hide
DELETE /lumina-feed/posts/:postId/hide
GET /me/hidden-posts?take=20
POST /users/:userId/block
DELETE /users/:userId/block
GET /me/blocked-users?take=20
Authorization: Bearer <accessToken>
```

Post hide is idempotent and uses soft delete/reactivation on
`community_hidden_posts`. Blocking rejects self-block, optionally accepts
`{ "reason": "..." }`, soft-deletes active follows in both directions, and uses
soft delete/reactivation on `user_blocks`.

## Admin Moderation APIs

These endpoints are for the future admin/operations screen. They require admin
auth and the new `community:read` / `community:write` permissions. Super admins
with `*` also pass.

```http
GET /admin/api/v1/community/reports?status=submitted&take=50
GET /admin/api/v1/community/posts?status=published&take=50
PATCH /admin/api/v1/community/reports/:reportId
POST /admin/api/v1/community/posts/:postId/hide
POST /admin/api/v1/community/posts/:postId/restore
```

Report query filters:

- `status`: `submitted`, `reviewing`, `resolved`, `dismissed`
- `reason`: `sexual_content`, `harassment`, `hate`, `impersonation`, `spam`, `other`
- `postId`
- `reporterUserId`
- `take`: 1-100, default 50

Post query filters:

- `status`: usually `published` or `hidden`
- `postType`: `user_post`, `artist_post`, etc.
- `artistSlug`
- `authorUserId`
- `take`: 1-100, default 50

Update report:

```json
{
  "status": "reviewing",
  "note": "Initial review started"
}
```

Hide post:

```json
{
  "reason": "sexual_content",
  "note": "Adult-style content is excluded from Korean MVP"
}
```

Restore post:

```json
{
  "reason": "false_positive",
  "note": "Restored after review"
}
```

Post hide/restore writes moderation metadata on `community_posts.metadata` and
creates `audit_events` rows. It does not hard-delete content.

## Admin Artist Operator APIs

Artist posts require an active `artist_operators` row. These admin endpoints let
operations grant or revoke that access.

```http
GET /admin/api/v1/artists/:artistId/operators
POST /admin/api/v1/artists/:artistId/operators
PATCH /admin/api/v1/artist-operators/:operatorId
```

They require admin auth plus `artists:write` permission.

Create/upsert operator:

```json
{
  "email": "operator@example.com",
  "role": "owner",
  "status": "active",
  "permissions": ["feed:post", "feed:reply"]
}
```

The backend also accepts `userId` instead of `email`. If the user already has an
operator row for the artist, the API reactivates and updates it.

Update/revoke operator:

```json
{
  "status": "revoked",
  "note": "No longer operating this artist"
}
```

Allowed `status`: `active`, `inactive`, `revoked`. `inactive` and `revoked` set
`revokedAt`; `active` clears it. All mutations create audit events.

### Follows

```http
POST /artists/:artistId/follow
DELETE /artists/:artistId/follow
POST /users/:userId/follow
DELETE /users/:userId/follow
GET /users/:userId/profile
GET /me/following
GET /me/following-artists
GET /me/following-users
GET /me/followers
Authorization: Bearer <accessToken>
```

`artistId` can be a UUID or an artist slug for frontend convenience. Normal
users can also be followed by UUID.

`GET /users/:userId/profile` is a public profile summary for active normal
users. It returns `{ user, stats, recentPosts }`, hides email, and only includes
public non-deleted posts in `recentPosts`.

## Frontend Notes

- Do not label this area as generic "Community".
- Recommended menu label: `루미나 피드`.
- Start with tabs: `전체`, `아티스트`, `팬 포스트`.
- Add `팔로잉` after the frontend wants authenticated filtering.
- Artist-post composer should only be visible after backend/admin grants operator access.
- Until admin screens exist, artist operator rows can be created by DB/admin operation.

## Admin/Operations Follow-Up

Implemented admin endpoints:

```http
GET /admin/api/v1/community/summary?take=10
GET /admin/api/v1/community/reports?status=submitted&take=50
GET /admin/api/v1/community/posts?status=published&minReports=1&sort=reports&take=50
PATCH /admin/api/v1/community/reports/:reportId
POST /admin/api/v1/community/posts/:postId/hide
POST /admin/api/v1/community/posts/:postId/restore
```

`PATCH /community/reports/:reportId` supports moderation actions:

```json
{
  "status": "resolved",
  "action": "hide_post",
  "resolveMatchingReports": true,
  "reason": "policy_violation",
  "note": "Hidden after review"
}
```

`action` can be `none`, `hide_post`, or `restore_post`. `resolveMatchingReports`
closes other open reports on the same post. If an action is provided and `status`
is omitted, the selected report defaults to `resolved`. Every mutation writes an
audit event.

Still not implemented:

- AI-assisted post generation.
- Attachment upload for feed images/videos.
