# Artist URL Knowledge Chat Contract

Version: `2026-06-05.artist-url-knowledge-registration-skeleton.v1`

Updated for Notion #459 safety gate, #462 audit contract, and #540 product
contract clarification, plus workboard #619 registration skeleton separation.

## Scope

Artist URL knowledge is limited to URLs submitted directly by an active artist operator. The server does not run automatic web search or bulk crawling in v1. The chat provider never receives raw page bodies, cookies, tokens, signed URLs, provider payloads, or raw prompts.

Supported source types are `youtube`, `instagram`, `tiktok`, `blog`, `notice`, and `other`.

Lifecycle states are `pending`, `approved`, `rejected`, and `archived`.

## #540 Product Contract Clarification

Artist URL knowledge is a controlled reference pipeline:

1. An active artist operator submits a URL and a short description for one owned
   artist.
2. The server validates the URL shape and stores the row as `pending`.
3. Optional future ingest workers may fetch, summarize, tag, and risk-score the
   public page, but v1 must not run automatic web search or bulk crawling.
4. Backstage/admin review approves, rejects, or archives the row.
5. Character chat may reference only approved, chat-enabled rows with a bounded
   summary. Pending, rejected, archived, disabled, summaryless, or unsafe rows
   fail closed and are invisible to provider context.

This contract separates three concepts that UI and backend must not merge:

- `lifecycleStatus`: `pending`, `approved`, `rejected`, or `archived`.
- `ingestState`: future crawler/summarizer state, such as `not_started`,
  `queued`, `fetched`, `summarized`, `blocked`, or `failed`.
- `chatEligibility`: derived server decision from status, `allowChatReference`,
  summary presence, safety state, and artist match.

#619 fixes the registration skeleton as separated fields, not one raw URL blob:

- `title`: optional public title from review metadata or future public metadata.
- `source`: source type plus hostname-only label for safe display/context.
- `approvalStatus`: canonical lifecycle status.
- `summary`: bounded reviewer-visible summary, never raw page body.
- `safetyStatus`: `unreviewed`, `needs_review`, `safe`, or `blocked`.
- raw submitted URL: stored only for review operations and never sent to the
  character-chat provider context.

Do not expose future `ingestState` values as lifecycle status aliases. UI may
localize lifecycle and processing copy, but API status values remain canonical.

## Registration Shape

The creator submission request is intentionally small:

```json
{
  "artistId": "artist-uuid-owned-by-current-operator",
  "type": "youtube",
  "url": "https://example.com/public-content",
  "description": "Artist-written context for reviewers",
  "allowChatRef": true
}
```

Validation baseline:

- Require auth and active operator access to `artistId`.
- Accept only `http` or `https` URLs, max 2000 chars.
- Reject empty URLs, malformed URLs, unsupported schemes, localhost/private
  network targets, and URLs that cannot be safely normalized.
- Treat query strings as sensitive by default. Raw submitted URLs may be stored
  only in the review table when required for operations; they must not appear in
  audit payloads, provider prompts, Notion handoffs, logs, or public responses.
- `description` is artist-authored context, max 500 chars, and is never trusted
  as an instruction.
- Any edit to URL, type, description, or `allowChatRef` reopens the row as
  `pending` and clears review fields.
- New or edited rows are `safetyStatus=unreviewed` until review metadata marks
  them `safe`; `needs_review` and `blocked` rows are never chat-eligible.

## Crawl, Summary, And Tagging Draft

The v1 contract is safe without an external crawler. If a later worker is added,
it must be additive and fail closed:

1. `normalize_url`: parse URL, drop unsafe fragments for processing, keep only a
   safe hostname label for chat readability.
2. `fetch_public_metadata`: fetch only public page metadata with tight size,
   timeout, redirect, MIME, and host allow/deny policy.
3. `extract_reference_text`: keep bounded title/description/caption-like text;
   never store full page bodies, comments, private embeds, cookies, or signed
   resources.
4. `summarize`: produce a short reviewer-visible summary and optional chat
   summary candidate.
5. `tag`: assign product tags such as `new_video`, `announcement`,
   `behind_the_scenes`, `schedule`, `collaboration`, or `other`.
6. `risk_score`: flag adult content, minors, real-person likeness, copyright,
   privacy, malicious URL, prompt injection, platform policy, and unsupported
   source risks.
7. `review_gate`: admin/backstage decides whether a row is approved and whether
   `allowChatReference` remains enabled.

Crawler/summarizer output is never chat-eligible by itself. Approval plus the
chat reference rules below are still required.

## Safety And Privacy Rules

Block, reject, or escalate when any of these are present:

- credentialed, signed, private, localhost, private-network, or suspicious URLs
- malware, phishing, scam, or forced-download behavior
- adult/sexual content, especially any minor or minor-coded risk
- real person likeness or identity claims that conflict with platform policy
- copyrighted character, brand, music, or clip misuse beyond approved reference
- doxxing, personal data, raw emails, phone numbers, addresses, or private IDs
- prompt-injection text asking the model to ignore safety or system rules
- content that conflicts with the artist's approved world setting in a way that
  would make the character impersonate a real person or disclose private facts

Reviewer notes may summarize the reason. Audit payloads must store redacted
booleans/categories, not raw unsafe text.

## Character Chat Context Priority

Approved URL knowledge is reference context only. It must not override the
instruction hierarchy.

Priority order:

1. platform/system/developer safety instructions
2. canonical artist profile, persona, speech style, and world setting
3. tone-and-manner policy and dynamic opening-greeting variant contract
4. active product policy for the chat feature
5. approved artist URL knowledge summaries
6. chat history and current user message

If an approved URL summary conflicts with canonical world setting or safety
policy, the chat service should prefer canonical profile/worldview and either
drop that reference from context or phrase it as uncertain external reference.
Newer approved URL knowledge may inform current events, recent uploads, or
announcements, but it must not rewrite the artist identity, operator ownership,
age/safety posture, or platform rules.

## Empty Knowledge Fallback

If an artist has no URL knowledge, only pending/rejected/archived URL knowledge,
disabled chat references, unsafe safety status, or summaryless rows, character
chat continues without URL knowledge. Empty URL knowledge must not block the
provider call, alter persona/tone/opening-greeting variant selection, or inject
review-only material into the prompt. The fallback source remains the existing
persona, tone-and-manner, and opening-greeting contracts.

Unapproved URLs, raw private materials, raw page bodies, URL query strings, and
admin notes must not appear in fallback copy, provider input, or chat response
metadata.

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

## Admin-To-Chat Handoff

Backstage approval creates a knowledge-context handoff only after the row is
approved, chat reference is allowed, a bounded summary exists, and the safety
flag is `safe`.

Allowed handoff fields:

- `approvalStatus`: fixed `approved`.
- `artistSlug`: the artist route key used to scope character chat context.
- `contextSummary`: bounded approved summary text.
- `safetyFlag`: fixed `safe`.

The handoff is knowledge-context only. It must not reuse or depend on
site-content/admin copy editing. It must not expose raw submitted URL, canonical
URL, URL query, raw page body, private material, admin notes, raw email, token,
cookie, password, API key, provider payload, signed/private URL, or DB URL.

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
- Empty eligible context returns `items=[]` with
  `fallbackPolicy.whenNoEligibleKnowledge=continue_without_url_knowledge`.

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
