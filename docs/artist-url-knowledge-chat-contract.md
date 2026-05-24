# Artist URL Knowledge Chat Contract

Version: `2026-05-22.artist-url-knowledge.v1`

Updated for Notion #459 safety gate.

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

## Chat Reference Rules

Character chat retrieval uses only rows where:

- `artistId` matches the current chat session artist.
- `status` is `approved`.
- `allowChatReference` is `true`.
- `summary` is present.

The provider prompt receives at most 5 summary fragments. It receives hostname labels only, not raw URLs. Reference text is marked as untrusted fact context and must never be treated as a system, developer, or user instruction.

Cost guard: retrieval is capped at 5 rows before the provider call, and each summary fragment is capped at 700 chars.

## #459/#463 Safety Gate

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

## #463 Verification Baseline

Provider-free tests must cover both layers:

- Service retrieval asks the database for only `status=approved` and
  `allowChatReference=true` rows for the current session artist.
- The context builder still drops pending, rejected, archived, disabled, and
  summaryless rows if a defensive or mocked path returns mixed data.
- The provider adapter receives only eligible context items, with
  `instructionRole=reference_fact_not_instruction`.
- Prompt-injection text in an approved summary can appear only inside the
  approved knowledge reference block. It must not be copied to user input and
  must not become a system or developer instruction.
- Raw submitted URLs and query strings stay out of provider instructions; only
  safe hostname labels may be present.
