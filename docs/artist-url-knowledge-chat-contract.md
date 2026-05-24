# Artist URL Knowledge Chat Contract

Version: `2026-05-22.artist-url-knowledge.v1`

Updated for Notion #459 safety gate and #462 audit contract.

## Scope

Artist URL knowledge is limited to URLs submitted directly by an active artist operator. The server does not run automatic web search or bulk crawling in v1. The chat provider never receives raw page bodies, cookies, tokens, signed URLs, provider payloads, or raw prompts.

Supported source types are `youtube`, `instagram`, `tiktok`, `blog`, `notice`, and `other`.

Lifecycle states are `pending`, `approved`, `rejected`, and `archived`.

## Creator API

`GET /api/v1/me/creator-studio/knowledge-urls`

Returns knowledge URL rows owned by the current artist operator. Optional query fields:

- `artistId`: restrict to one owned artist.
- `status`: one of `pending`, `approved`, `rejected`, `archived`.

`POST /api/v1/me/creator-studio/knowledge-urls`

Creates a `pending` row. Request body:

- `artistId`: owned artist UUID.
- `type`: source type.
- `url`: `http` or `https`, max 2000 chars.
- `description`: artist-written reference description, max 500 chars.
- `allowChatRef`: boolean, default `true`.

`PATCH /api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId`

Allows the artist operator to revise `type`, `url`, `description`, or `allowChatRef`. Any edit reopens the row as `pending` and clears review fields. Archived rows cannot be edited.

`POST /api/v1/me/creator-studio/knowledge-urls/:knowledgeUrlId/archive`

Moves the row to `archived`; archived rows are never eligible for character chat reference.

## Admin API

`GET /api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls`

Requires `artists:read`.

`POST /api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/approve`

Requires `artists:write`. Sets `status=approved`, records reviewer audit fields, and optionally replaces the summary. Approved rows are chat-eligible only when `allowChatRef=true`.

`POST /api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/reject`

Requires `artists:write`. Requires `reason`, sets `status=rejected`, and blocks chat reference.

`POST /api/v1/admin/api/v1/backstage/operations/artist-knowledge-urls/:knowledgeUrlId/archive`

Requires `artists:write`. Sets `status=archived` and blocks chat reference.

## Audit Contract #462

Creator Studio registration/revision/archive and Backstage review actions write
`audit_events` with `targetType="artist_knowledge_url"` and the knowledge URL
id as `targetId`.

Event names:

- `creator_studio.artist_knowledge_url.create`
- `creator_studio.artist_knowledge_url.update`
- `creator_studio.artist_knowledge_url.archive`
- `artist_knowledge_url.approve`
- `artist_knowledge_url.reject`
- `artist_knowledge_url.archive`

The audit payload is intentionally redacted. `beforeData` and `afterData` store
only the audit contract version, knowledge URL id, artist id, submitted/reviewed
user ids, lifecycle status, source type, `allowChatReference`, summary/rejection
presence booleans, and review/archive timestamps. `metadata` stores the status
transition, changed field names, and safety booleans such as
`rawUrlStored=false`, `rawPageBodyStored=false`,
`tokenCookiePasswordStored=false`, `providerPayloadStored=false`, and
`dbUrlStored=false`.

Do not store raw submitted URLs, canonical URLs, artist descriptions, summary
text, rejection reason text, fetched page bodies, tokens, cookies, passwords,
provider payloads, DB URLs, or signed/private URLs in audit `beforeData`,
`afterData`, or `metadata`.

Read-only audit lookup may be used by admins with `audit:read`, but it must rely
on the redacted audit payload above. Backstage artist knowledge list/review
endpoints may show the submitted URL needed for review, but no fetched raw page
body or provider payload is stored or returned by this contract.

Failure routing:

- If a Creator Studio registration/update/archive does not create an audit
  event, keep follow-up with Kaido/backend.
- If Backstage approve/reject/archive lacks an audit event, keep follow-up with
  Kaido/backend.
- If QR cannot see audit lookup due to role/permission setup, route to the
  Backstage/admin permission owner rather than frontend owners.
- If the live fixture account cannot reach Creator Studio, use the QA account
  self-check handoff from #458 before changing existing fixture rows.

## Chat Reference Rules

Character chat retrieval uses only rows where:

- `artistId` matches the current chat session artist.
- `status` is `approved`.
- `allowChatReference` is `true`.
- `summary` is present.

The provider prompt receives at most 5 summary fragments. It receives hostname labels only, not raw URLs. Reference text is marked as untrusted fact context and must never be treated as a system, developer, or user instruction.

Cost guard: retrieval is capped at 5 rows before the provider call, and each summary fragment is capped at 700 chars.

## #459 Safety Gate

The chat service must apply the state gate before provider generation:

- Query filter: `artistId=<session artist id>`, `status=approved`, and
  `allowChatReference=true`.
- Defensive context filter: pending, rejected, archived, disabled, and
  summaryless rows are dropped even if they reach the context builder.
- Provider adapter marking: each reference line is labeled
  `role=reference_fact_not_instruction`; URL/summary text is never elevated to a
  system, developer, or user instruction.
- Prompt-injection text inside an approved summary can be passed only as
  untrusted reference text. It must not change the instruction hierarchy.
- Raw submitted URLs stay out of provider input. Hostname labels may be used for
  source readability.

Provider-required tests should be separate from contract tests. The approved
state gate, defensive filtering, raw URL redaction, and prompt-injection role
labeling can be validated without a live provider call.
