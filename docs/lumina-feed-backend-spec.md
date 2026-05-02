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

## Public/Frontend APIs

### Feed

```http
GET /lumina-feed?mode=all&take=20
GET /lumina-feed?mode=artists&take=20
GET /lumina-feed?mode=fans&take=20
GET /lumina-feed?artistSlug=yoon-serin
GET /lumina-feed/samples?mode=all&take=20
GET /artists/:slug/posts
```

`mode` values:

- `all`
- `artists`
- `fans`

Sample `mode` also accepts `debut` for debut applicant style posts.

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

### Create Post

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
      "body": "리허설이 끝났습니다...",
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

```http
POST /lumina-feed/posts
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
  "body": "무대는 짧고, 시선은 오래 남아.",
  "visibility": "public"
}
```

If `artistId` or `artistSlug` is provided, the backend requires an active
`artist_operators` row for the current user and artist.

Body rules:

- `body`: 1-500 characters.
- `visibility`: `public` or `followers`, default `public`.
- MVP only exposes `public` feed. `followers` is reserved for later UI/policy work.

### Replies

```http
GET /lumina-feed/posts/:postId/replies
POST /lumina-feed/posts/:postId/replies
Authorization: Bearer <accessToken>
```

Body:

```json
{
  "body": "이 말투 너무 최서진 같다."
}
```

Reply body is 1-300 characters.

### Likes

```http
POST /lumina-feed/posts/:postId/like
DELETE /lumina-feed/posts/:postId/like
Authorization: Bearer <accessToken>
```

Like is idempotent. If the same user already liked the post, the backend returns
`idempotentReplay: true`.

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

### Follows

```http
POST /artists/:artistId/follow
DELETE /artists/:artistId/follow
GET /me/following
Authorization: Bearer <accessToken>
```

`artistId` can be a UUID or an artist slug for frontend convenience.

## Frontend Notes

- Do not label this area as generic "Community".
- Recommended menu label: `루미나 피드`.
- Start with tabs: `전체`, `아티스트`, `팬 포스트`.
- Add `팔로잉` after the frontend wants authenticated filtering.
- Artist-post composer should only be visible after backend/admin grants operator access.
- Until admin screens exist, artist operator rows can be created by DB/admin operation.

## Admin/Operations Follow-Up

Not implemented yet:

- Admin endpoints for granting/revoking artist operator access.
- Admin moderation queue for reports.
- Post hide/delete endpoints.
- AI-assisted post generation.
- Attachment upload for feed images/videos.
