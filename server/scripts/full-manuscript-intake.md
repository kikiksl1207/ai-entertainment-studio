# Bounded complete manuscript intake (#1853)

## Implemented boundary

`POST /api/v1/me/creator-studio/stories/:workId/manuscripts/file` accepts one
multipart file field named `manuscript`, with a `.json` filename and media type
`application/json`, `text/plain`, or `application/octet-stream`. JWT and ownership
of an existing work are required. Missing and other-owner works both return 404.
This is a **new owned-work file path**, not consumption or promotion of an old
`story-upload/intake` receipt. It uses the existing Nest/Multer stack and existing
manuscript-version table, without a schema, bootstrap, package, or UI change.

The complete file contract is the converter's `analysis-input.json` projection:
root `locale` and `parts`; each part has `partKey`, `title`, and `paragraphs`; each
paragraph has `kind` and `text`. Supported locales are `ko`, `en`, `ja`, `zh-Hans`,
and `zh-Hant`. Kinds are `title`, `scene_break`, `paragraph`, and `dialogue`.
Unknown or missing fields, duplicate part keys, invalid UTF-8, malformed JSON,
duplicate JSON member names (including escaped aliases), NUL, and lone Unicode
surrogates are rejected. JSON.parse is the grammar parser; a bounded lexical
precheck rejects duplicate names and nesting deeper than eight levels. Production
does not depend on TypeScript or another development parser.

One complete request creates one immutable version containing every supplied
part, in order. It does not divide a document into complete-version chunks.
Transport truncation, missing required fields, empty parts, and unfinished JSON
fail closed. A syntactically valid subset cannot be identified as incomplete
without an authoritative expected inventory; the API does not claim otherwise.
The prior offline source audit supplies that independent inventory for the two
locally verified documents. No source approval or publication flags are invented.

No analysis job/evidence, release, entitlement, asset, or provider call starts.
Work creation, the author UI/file picker, promotion of old intake receipts, and
publication remain outside this change. A plain-text novel is not silently
treated as the structured JSON contract; the offline converter remains upstream.

## Identity, privacy, and atomicity

- File byte identity is SHA-256 of the uploaded file buffer, excluding multipart
  headers. Fatal UTF-8 decoding retains an initial BOM, whitespace, CRLF, JSON
  escapes, and Unicode spelling in private `intake.source.rawText`. Re-encoding
  that string as UTF-8 reconstructs exactly the accepted file bytes. Only the
  initial BOM is omitted from the JSON parse input. Parts/text are never trimmed,
  normalized, or rewritten. The projection has no new route/approval semantics.
- Version identity uses the existing stable-JSON SHA-256 helper over
  `{ identityVersion: 2, locale, parts }`. Array order and exact text matter; JSON
  object-key order and formatting do not. Same content in different locales is
  distinct. Same-content retries reuse the version, including after response loss.
- Same-locale legacy `{parts}` hashes reuse the existing version ID/hash without
  mutation, preserving release/version references. Other locales do not collide
  with that legacy row. A matching version belonging to a prior owner is not
  exposed or reused. No legacy backfill or global hash migration occurs.
- `rawSource` distinguishes new storage, unchanged existing storage, and a legacy
  projection-only version. `received.sha256` describes the current request, not
  necessarily the bytes retained by an earlier semantic duplicate. Replays never
  replace the first stored raw source. The old JSON endpoint shares the store,
  but marks its reserialized validated body `json_projection`, not original HTTP
  wire bytes. Its DTO150 and default JSON body limit remain unchanged.
- A parameterized work-row `FOR UPDATE` lock, ownership recheck, duplicate lookup,
  version allocation, and single-row create share one serializable transaction.
  P2002/P2034 conflicts retry at most three attempts. Each attempt has a 2-second
  connection wait and 10-second transaction timeout. Transaction failures return
  a sanitized retry error, not Prisma's possibly manuscript-bearing exception.
- Responses, including duplicates, contain only manuscript receipt fields,
  request counts/hash/size, replay/raw-source status, and `analysisStarted:false`.
  They exclude the manuscript, private provenance, owner ID, and storage keys.
  This implementation never logs manuscript text.

### Existing JSON compatibility

The JSON route now adapts its already validated DTO directly, rather than running
the strict file parser again. ValidationPipe and the existing DTO remain its
validation authority; the adapter is not an untrusted-file validator. Both paths
still share locale-aware identity, legacy-version lookup, atomic storage, receipt
privacy, and the serialized-storage cap. No approval or schema changes are added.

| Input rule | Existing JSON route | New file route |
| --- | --- | --- |
| Key/title/text length | DTO character count, 80/240/10,000; surrogate pairs count as one | UTF-16 units, 80/240/10,000 |
| Empty/whitespace key or title | Allowed by existing IsString/MaxLength | Rejected |
| Repeated part keys | Existing DTO permits; retained in order | Rejected |
| Required/unknown/null fields | Existing ValidationPipe/DTO rejects | Strict structure rejects |
| Optional/default manuscript fields | None in current DTO; none fabricated | None |
| Empty paragraph text / Unicode normalization | Allowed / never normalized | Allowed / never normalized |
| Duplicate JSON members / wire decoding | Already interpreted by the JSON body parser; projection evidence only | Duplicate members and invalid UTF-8 rejected; exact file bytes retained |

NUL/lone-surrogate strings are not newly filtered by the legacy adapter; the DTO
can accept them but PostgreSQL JSONB cannot persist them. This does not claim
that every DTO-valid value was previously storable. The file parser retains its
explicit rejection. The 40 MiB storage cap is far above a body accepted by the
unchanged 100 KiB JSON endpoint; file limits are not applied as new DTO semantics.

## Bounds and resource costs

| Boundary | Limit |
| --- | ---: |
| File bytes | 16 MiB (16,777,216) |
| Entire multipart request | 16 MiB + 16 KiB (16,793,600) |
| File count / ordinary form fields | 1 / 0 |
| Upload duration | 60 seconds |
| Parts / paragraphs per part / total paragraphs | 1,000 / 5,000 / 200,000 |
| Part key / title / paragraph text | 80 / 240 / 10,000 UTF-16 units |
| Serialized private structured body | 40 MiB (41,943,040) |
| Active file intake per application worker | 1 |
| Accepted admission attempts per actor | 3 per fixed 60-second window |
| Live actor-rate buckets per worker | 1,024 |

Content-Length is required and checked before multipart buffering; encoded or
chunked requests are rejected. Counted stream bytes must equal the declaration;
overrun and timeout destroy the stream. Multer independently bounds file size,
files, and fields. A file-size allowance of one extra byte accounts for Busboy's
inclusive limit event; the actual accepted file maximum is still exactly 16 MiB.
Admission is released on parser failure, abort, or downstream completion/error.
Before releasing admission for an early parser error, an unfinished request is
unpiped and destroyed so Multer's drain cannot continue without the byte timer.
Such an incomplete request can end with a closed connection rather than a JSON
error response; already completed requests retain sanitized HTTP errors.
The admission guard is process-local, not a distributed rate limiter. Ownership
queries and rejected pre-admission requests still need normal edge protection.

Raw JSON and the parsed projection are both stored deliberately: JSONB/parts alone
cannot preserve source whitespace, BOM, or escape spelling for byte/hash evidence.
Keeping them in the same row makes version plus byte evidence atomic without a
new blob service, orphan-file cleanup, or schema migration. This is not a second
raw file on disk. `storedBytes` limits serialized JSON before the DB write, not
PostgreSQL physical/WAL/index size or an existing DB constraint.

Let B be accepted file bytes (at most 16 MiB). Before the 40 MiB serialized-body
check, worst-case serialization can approach 3B plus fixed metadata: up to 2B
for escaped raw JSON and B for compact parts. At maximum input the accepted
stored representation is capped at 2.5B; smaller, heavily escaped documents can
approach 3x. Actual inputs below measured about 2.08x. No gzip savings are assumed.

The byte cap is **not** a heap/RSS cap. A conservative payload-only planning
envelope includes up to 2B of Multer chunks/concatenation, 2B decoded UTF-16 raw
text, 2B projected string data, and up to 6B temporary UTF-16 stored serialization:
12B (192 MiB at maximum input), before object overhead. Each existing recursive
canonical-hash pass also creates strings at several levels; budgeting five
aggregate B-sized levels at two bytes per unit for each of two hash passes adds
20B if garbage has not yet been collected. Thus plan for roughly 32B (512 MiB)
of transient payload allocations **plus** objects, lexical sets, ORM encoding,
runtime, and DB driver overhead, not a guaranteed or measured RSS ceiling.
The single-worker admission cap limits concurrent file parses but not unrelated
application traffic or multiple workers. Low-memory production enablement still
requires a measured heap/latency/DB load test and matching edge admission limits.

## Local evidence and reproduction

Four explicitly selected Jest suites passed after the compatibility fix:
**70 tests**, one process, no build,
install, Prisma generate, HTTP listener, provider, or external DB. The suites are
`story-manuscript-file.policy.spec.ts`, `story-manuscript-version.store.spec.ts`,
`story-manuscript-file.controller.spec.ts`, and existing
`story-production.service.spec.ts`, all under `server/src/story-production`.
Fixtures are synthetic. Tests exercise the real Nest/Multer parser with local
streams and the store with transaction doubles, not live PostgreSQL locking.
The added regressions use the actual existing ValidationPipe/DTO for Unicode
key/title/paragraph boundaries, blank/repeated keys, missing/unknown/null fields,
legacy IDs and locale separation. Incomplete multipart tests cover both missing
boundary and unexpected-file-field rejection before releasing admission.

Invoke the existing Jest entry directly with `--runInBand --runTestsByPath` and
these four paths, using an E-local ts-jest configuration/cache. Do not use
`npm test` in the coordinated workspace because its pretest generates Prisma.

`verify-full-manuscript-intake.mjs INPUT_JSON SERVER_NODE_MODULES` loads current
source via the existing TypeScript dependency only in this offline harness. It
uses the actual controller/parser/store with an in-memory transaction double,
verifies full part/text equality, raw roundtrip, request replay, one version,
receipt privacy, and unchanged input SHA-256/mtime. It prints counts/hashes only.

| Approved revision-2 input | Parts | Paragraphs | File bytes | Stored JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| Imjin | 75 | 19,537 | 2,547,918 | 5,298,073 |
| Norse | 216 | 104,036 | 11,466,327 | 23,871,361 |

Source SHA-256:

- Imjin: `d6153f69ffa9689c9c1453854f3401d49612d46f7e8614ad26c893ce30ec2995`
- Norse: `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8`

Both local runs passed with one insertion and two transactions (initial request
and replay). All 291 parts roundtripped; original hash/mtime stayed unchanged.
No actual manuscript or derived JSON is committed. These results are intake
evidence, not evidence that AI analysis is accurate, complete, or affordable.

## Remaining runtime gates

Independent candidate QA, authorized build/integration, real PostgreSQL
serialization/ownership/concurrency/rollback verification, memory and latency
measurement, and deployed proxy/request-size compatibility remain unverified.
The application-wide default JSON parser remains 100 KiB (102,400 bytes); this
multipart-only route does not increase it. A deployment proxy can still reject
this new route before Nest; no deployed proxy acceptance is claimed.

The existing explicitly invoked analysis endpoint still performs synchronous
per-evidence persistence. Receiving 104,036 paragraphs does not prove that
analysis path can process them; this intake never invokes it. Async/batched
analysis is separate engineering work, not author metadata or an author rewrite
request. Rights/price approval, actual imagery, runtime-generated B/C routes,
ending mapping, and publication validation remain separate from version receipt.
