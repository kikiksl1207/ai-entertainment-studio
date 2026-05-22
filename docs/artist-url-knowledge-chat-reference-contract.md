# Artist URL Knowledge And Character Chat Reference Contract

Contract version: `2026-05-22.artist-knowledge-sources.v1`

## Purpose

Creators can register public URLs that describe their own artist activity. The
server stores the URL plus creator-entered description/summary as a reviewable
knowledge source. Character chat can reference only approved, chat-visible
summary snippets for the matching artist.

This contract does not crawl the open web, does not require social account
passwords/API keys/tokens, and does not inject full URLs or raw source bodies into
the provider runtime prompt.

## Storage Shape

Table: `artist_knowledge_sources`

Required fields:

- `artist_id`
- `source_url`
- `source_domain`
- `source_platform`
- `source_type`
- `artist_description`
- `summary`
- `visibility`
- `status`

Review fields:

- `approved_at`
- `rejected_at`
- `archived_at`
- `reject_reason`
- `reviewed_by_user_id`

The unique key is `(artist_id, source_url)`. Re-registering the same artist URL
returns the existing row as `idempotentReplay: true` and does not create another
mutation.

## Creator Studio API

All endpoints require `Authorization: Bearer <accessToken>` and an active artist
operator row for the target artist.

The read-only chat reference contract is exposed at:

```http
GET /api/v1/chat/artist-url-knowledge-contract
```

```http
GET /api/v1/me/creator-studio/knowledge-urls?artistId=<artistId>&status=pending
POST /api/v1/me/creator-studio/knowledge-urls
PATCH /api/v1/me/creator-studio/knowledge-urls/:sourceId
POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/approve
POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/reject
POST /api/v1/me/creator-studio/knowledge-urls/:sourceId/archive
```

Create body:

```json
{
  "artistId": "uuid",
  "type": "youtube",
  "url": "https://youtube.com/watch?v=abc",
  "description": "Creator-entered context for this material.",
  "summary": "Optional short summary. Defaults to description.",
  "allowChatRef": true,
  "title": "Optional title",
  "idempotencyKey": "optional-client-key"
}
```

Update accepts the same editable fields except `artistId`. It is allowed only
while the row is `pending` or `rejected`; successful update returns the row to
`pending`.

Reject body:

```json
{
  "reason": "Optional reviewer note, max 500 chars"
}
```

## State Transitions

| Action | From | To | Authority |
| --- | --- | --- | --- |
| create | none | `pending` | active artist operator |
| update | `pending`, `rejected` | `pending` | active artist operator |
| approve | `pending`, `rejected` | `approved` | owner/admin/staff/internal or artist knowledge review/manage permission |
| reject | `pending`, `approved` | `rejected` | owner/admin/staff/internal or artist knowledge review/manage permission |
| archive | `pending`, `approved`, `rejected` | `archived` | active artist operator |

Repeated approve/reject/archive calls on an already matching terminal state return
`idempotentReplay: true` and do not perform a second mutation.

## Character Chat Runtime Rule

Generation reads at most three rows per artist where:

- `status = approved`
- `visibility in (chat_reference, public)`
- `approved_at is not null`
- `archived_at is null`

Provider runtime receives only:

- `domain`
- `platform`
- `title`
- `summary`

Full URL, raw source body, credentials, tokens, cookies, provider payloads, and
raw prompts are not passed to the provider runtime. Source text is labeled as
facts-only reference material and never as instructions. URL-like strings and
prompt-injection phrases inside summaries are sanitized before runtime use.

## Explicit Non-Goals

- No automatic crawling or bulk external-site storage.
- No external social account connection requirement.
- No wallet, Lumina, order, settlement, payout, or paid-like mutation.
- No raw secrets, cookies, tokens, DB URLs, signed URLs, or provider payloads in
  logs/docs.
