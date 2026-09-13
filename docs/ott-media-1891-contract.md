# OTT #1891: Private Intake Candidate

Base: `ea64d59ddb0431d45ed178695e893808e86af817` (origin/main).
Candidate branch: `codex/kaido-1891-ott-intake-20260914`.

## Scope and Release Gate

This is a bounded private-local server foundation, not a deployed OTT player,
remote S3/R2 implementation, real-media certification, or 15-minute demonstration.
No StoryProduction, StoryUpload, UI, package, lock, main.ts, assets/common/config
files are changed. Novel manuscripts are not used as OTT scripts or fixtures.

`render:start` automatically applies pending migrations (see
`docs/render-operations.md` and `server/package.json`). This candidate MUST stay
on its origin branch pending independent QR1 review and explicit release/DB
authorization. Do not merge/push main or trigger Render with this migration under
the current no-live-migration authorization. Zoro owns eventual integration.

## Existing Contracts Reused

- `assets/user-assets.service.ts` and its module/controller were read first.
  Their image/public asset records, public URL construction and metadata-only
  local confirmation are not appropriate for private media and are not called.
- `common/asset-url.ts` constructs public URLs, including external URL passthrough;
  it is deliberately excluded from OTT delivery.
- `premium-videos` exposes product asset projections; no OTT original is linked
  to those products, generic `Asset`, feed, profile, or public catalog records.
- `story-upload-storage` supplies the existing private-root/key validation,
  checksum and bounded-storage/error pattern. Its implementation is not edited
  or called because it buffers input and also uses shared public-capable buckets.
- Existing JWT/current-user guard, ConfigService, PrismaModule/client CRUD and
  common HTTP error envelope are reused. Only lock acquisition uses tagged SQL.

## API

The following owner endpoints require the existing bearer access token.
All paths include the existing `/api/v1` global prefix.

1. `POST /me/ott-media/works` with `{ "title": "Private work" }` returns
   `authorId` derived from the authenticated user, `workId`, `versionId`, version 1.
2. `POST /me/ott-media/works/:workId/versions` with `{}` allocates the next version
   under a work lock. It never copies an earlier original or creates generated media.
3. `POST /me/ott-media/versions/:versionId/upload-intents` requires
   `Idempotency-Key` (8-100 ASCII letters/digits/underscore/hyphen) and:

   ```json
   {
     "sha256": "64-lowercase-hex-characters",
     "sizeBytes": 12345,
     "mimeType": "video/mp4",
     "declaredDurationMs": 1000,
     "audioLocale": "ko"
   }
   ```

   The size limit is 64 MiB, duration limit 20 minutes, intent lifetime 15 minutes.
   This is a registration, not proof that a file exists. `media` is null until
   confirmed. The receipt contains a file ID and owner-only PUT path, not a raw
   storage key, cloud credentials or public URL.
4. `PUT /me/ott-media/files/:fileId/object` sends the raw MP4 stream with
   `Content-Type: video/mp4`; no multipart, base64, compressed request body or
   external URL. Stream writes have a 60-second deadline, byte cap, checksum,
   temporary-file cleanup and atomic no-replace publication. Success is
   `uploaded`, never playable/ready. Aborted, truncated, oversized and wrong
   checksum streams do not publish a completed object.
5. `POST /me/ott-media/files/:fileId/confirm` with `{ "subtitles": [] }` or
   separate tracks such as:

   ```json
   { "subtitles": [
     { "locale": "ko", "cues": [
       { "startMs": 0, "endMs": 900, "text": "Subtitle text" }
     ] }
   ] }
   ```

   Confirmation checks persisted registration, stored size and SHA-256, container
   magic and actual ffprobe stream/packet evidence. Client duration is only an
   expectation, compared with measured video duration within 250 ms. Both H.264
   video and AAC audio are required; the media must be readable through a pipe.
   Non-streamable/unsupported containers fail closed; no automatic remux occurs.
   `ko` voice is uploader-declared, NOT speech-language detection.
6. `GET /me/ott-media/files/:fileId` returns the owner-only receipt/state.
7. `GET /me/ott-media/files/:fileId/preview` verifies the object again and returns
   measured media information, only actually available subtitle tracks/cues, and
   delivery descriptors. Subtitle locales are `ko`, `en`, `ja`, `zh-Hans`,
   `zh-Hant`; missing locales are omitted, never marked translated. Cues must be
   finite integer milliseconds, ordered/non-overlapping, nonempty plain text,
   bounded and inside verified duration. Subtitle payload becomes immutable at
   confirmation. A replacement subtitle set requires a new version.

The API-only descriptor uses the bearer token plus short HMAC headers. Native
`<video src>` cannot supply those headers; it must use the browser session below.
`choices: []`, `maxRecommendations: 3`, `directInput: deferred`, and
`routing: not_implemented` are explicit boundaries, NOT a working branch engine.
Unknown fields, including choice targets, URL imports and generated-job claims,
are rejected. No missing target is substituted with an existing ready file.

## Browser Range Session and Refresh

- Authenticated `POST /me/ott-media/files/:fileId/playback-session` with `{}`
  requires an exact approved HTTPS `Origin` and rejects `Sec-Fetch-Site: cross-site`.
  It sets a host-only `__Secure-ott-preview` cookie with HttpOnly, Secure,
  SameSite=Strict, exact file-delivery Path, and Max-Age=60. The AES-256-GCM cookie
  is opaque and binds owner, file, version, verified checksum and expiry.
- The JSON response contains only a relative delivery path and expiration.
  The cookie is never returned in JSON or placed in a URL. The browser must accept
  the Set-Cookie response; a same-site frontend session request uses credentials.
- `GET /ott-media/private-files/:fileId/delivery` requires that cookie, verifies
  its authentication/scope/expiry and the account's current active/not-deleted
  state, rechecks persisted ownership and the verified object, then streams from
  the same open file descriptor. It supports single byte ranges, `206`,
  `Content-Range`, and `416`. It never loads the whole movie into a Node Buffer
  or requires a browser fetch-to-Blob workaround. Responses are private/no-store
  and restrict cross-origin resource use to same-site.
- After 60 seconds, a NEW seek/Range request needs a fresh authenticated POST to
  the same playback-session endpoint. A response already streaming may finish;
  expiry is checked when the request is authorized. A 15-minute viewing session
  therefore needs player-controlled refresh before expiry and retry handling.
  That player behavior is NOT implemented here.
- Refresh requires the normal current bearer token. Account disabling/deletion
  blocks subsequent native requests immediately. Logout/password change/account
  switch do NOT synchronously revoke an already issued delivery capability;
  its maximum remaining lifetime is 60 seconds. Immediate revocation and logout
  cookie-clearing hooks are follow-up integration work, not claimed here.
- `OTT_MEDIA_BROWSER_ORIGINS` is an explicit JSON allowlist of exact HTTPS origins;
  it has no wildcard/public-config fallback. Missing allowlist fails closed only
  for browser-session/delivery requests. A no-Origin native GET is permitted only
  with a valid capability; explicit unapproved origins/cross-site requests fail.
  Existing global credentialed CORS must also permit the legitimate frontend's
  session POST. This change does not broaden global CORS. Cross-site deployments
  and third-party-cookie workarounds are unsupported.
- Actual Chrome/Safari/mobile cookie policy, CORS/preflight and native decoder
  playback have NOT been browser-tested. Loopback HTTP tests manually carry the
  cookie and prove server behavior, not browser acceptance or real media playback.

## Storage and Runtime Configuration

OTT providers are lazily used: absent settings do not add startup I/O or affect
the existing health controller. No secret, root or probe has a development
fallback that can mark media confirmed. Required configuration names:

- `OTT_MEDIA_STORAGE_MODE=private_local` only. `local`, `metadata_only`, `s3`,
  `r2`, absent and unknown modes all fail closed. Remote object HEAD/ACL/version
  verification and signed cloud delivery are not implemented; no remote request
  is made by this adapter.
- `OTT_MEDIA_LOCAL_ROOT`: explicit absolute private filesystem root outside the
  application checkout and all public static roots. Windows requires E:.
  Every ancestor is checked for symlinks/junctions before and after directory
  creation. Object names are server UUIDs, not caller filenames/paths/URLs.
- `OTT_MEDIA_PUBLIC_ROOTS`: explicit JSON list of absolute public filesystem
  roots. `[]` is an explicit no-public-static-roots inventory, not a discovery
  mechanism. Nested or enclosing overlaps with app/public roots are rejected.
- `OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED=true`: deployment attestation that the root
  and its ancestors have service-only write access and are not publicly served.
  POSIX root group/other mode bits are checked; Windows ACL auditing remains an
  operator responsibility. This code does not change ACLs or defend against a
  privileged operator rewriting file bytes while a response is already streaming.
- Production/staging also require `OTT_MEDIA_DURABLE_ROOT_CONFIRMED=true` AFTER
  persistent-volume/backup/ACL checks. An ephemeral Render filesystem is not a
  supported durable store. The boolean is an operator attestation, not a detected
  persistent mount. No such production verification occurred in this task.
- `OTT_MEDIA_FFPROBE_PATH`: approved existing absolute ffprobe binary path. No
  binary was found on PATH, in server deps or in the inspected E Codex runtime
  tree. No download/install/probe invocation occurred. Minimum follow-up is an
  approved pinned binary in an E tools directory plus synthetic and real-media
  validation. The adapter uses pipe input only, no shell and no network/file
  protocols, 15-second deadline, 8 MiB metadata-output cap and error rejection.
  It validates demuxed video/audio timing and container/codec evidence, not
  linguistic content, rights, full decode quality or malicious-code safety.
- `OTT_MEDIA_DELIVERY_SECRET`: independently provisioned high-entropy secret,
  at least 32 bytes; no hardcoded/shared JWT secret fallback. Rotation invalidates
  existing capabilities. Do not log this value, auth headers, cookies, signed
  delivery headers, original video, manuscript or subtitle text.

Storage/probe interfaces are separate for later immutable private S3/R2 or worker
adapters. Adding one requires real ACL/public-access-policy verification, timeout
and failed-HEAD handling, immutable object versions/checksums and authorized
short delivery; reusing the image bucket is not sufficient.

## Persistence and Failure Recovery

Three private tables: `OttMediaWork`, `OttMediaVersion`, `OttMediaUpload`.
Version-to-work and work-to-owner relationships are checked before intake.
Upload IDs are not generic Asset IDs. One registered original is allowed per
version; expired registrations require a new version rather than rebinding the
old ID. There is no original replacement/delete/publish API in this slice.

Owner/idempotency-key uniqueness plus owner row locks serialize intent races.
File row locks serialize upload/confirm races across processes. Only necessary
lock reads use tagged SQL; CRUD is Prisma. Migration guards enforce immutable
registration/confirmation and monotonic status. Its extra owner FK/checks/trigger
are deliberate database constraints, not extra Prisma models.

Identical confirmation retries return the same receipt without probing twice;
different subtitle payload conflicts. Failed verification leaves `uploaded` and
can be retried before expiry. Stored objects are checked again for confirm replay,
preview and every delivery request, so later deletion/replacement cannot silently
reuse a confirmed receipt for playback. Invalid persisted states are not promoted.

A process crash after atomic file promotion but before DB commit can leave an
unconfirmed orphan; the same unexpired upload can retry identical bytes without
replacement. Temp files are removed on normal failure/abort; a hard process kill
may leave `.pending` files. Durable orphan retention/cleanup policy is follow-up
operations work; no automatic deletion job is added.

## Verification and Usage Projection

All execution/output uses E cwd/TEMP/TMP/cache. One approved Prisma generate used
the existing installed client (reported v6.19.3); no dependency install, build,
migration deploy, real database, paid provider, production mutation or video
network download. Target TypeScript check is `src/ott-media/tsconfig.check.json`.
Run only the six exact `ott-media.*.spec.ts` test paths with direct Jest
`--runInBand`; do not run `npm test`, whose pretest regenerates shared Prisma.

Tests distinguish:

- Actual tiny local files: capped stream intake, abort cleanup, no-replace
  publication, reopen/hash, Range streaming, path/junction rejection.
- Real Nest/controller/filter/module and loopback HTTP: existing health handler,
  receipt flow, cookie/Range/416, origin denial, generic asset 404 and disabled
  account refusal, with explicit auth/DB/probe doubles.
- Synthetic ffprobe JSON and missing-binary behavior: no real-media duration or
  decoder proof. The 30-byte fixture is intentionally not a playable video.
- Prisma call/lock/mutation contracts: no real Postgres transaction, migration
  application or multi-process race was exercised.

Final local evidence on 2026-09-14: six exact-path Jest suites, 84/84 tests PASS
(14.944 seconds), and the bounded no-emit TypeScript check PASS. Results are in
`E:/CodexMovedCache/tmp/kaido-1891/jest-results.json`. Initial failures exposed a
Windows lstat device-number difference, noncanonical cookie encoding and a
cross-realm Date in the test double; all were corrected before the final pass.
The heavy/shared-client slot was returned before candidate reporting/push.

Usage projections (limits, not measured 15-minute performance): one original is
at most 64 MiB; one in-flight temp may add the same amount. Every preview/Range
authorization hashes the complete capped file, then delivers the requested
range. This is intentionally expensive but bounded; large-file performance and
verified immutable-object caching are follow-up work. Probe metadata buffers are
capped at 8 MiB; video transfer remains streaming. No AI/TTS/provider billing or
external storage API usage is introduced by this implementation/test run.

Remaining release blockers: independent QR1 review; approved ffprobe and real
media validation; actual PostgreSQL migration/locking tests; durable private
deployment/ACL verification; browser CORS/cookie/native Range/refresh testing;
explicit deployment/migration authorization. Full branch persistence, player UI,
AI video/TTS/provider jobs, recommendation routing and reuse/pricing engines are
not implemented.
