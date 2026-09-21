# OTT authored branching private playback (#1898)

Source implementation contract. Execution evidence is tracked separately; this document is not a claim of passing tests, playable uploaded films, public release, or generated video.

## Ownership and version boundaries

- This slice is creator-owned private preview only. Every endpoint uses the existing authenticated owner identity. Graphs, preview pins and viewing progress have the same owner and work; foreign IDs return `OTT_NOT_FOUND` without their contents.
- An existing `OttMediaVersion` is a **source asset version**, with its existing unique single upload unchanged. A `OttPlaybackManifest` revision is a separate **compound graph revision**, not another name for a source asset version.
- A graph explicitly assembles multiple source versions from the same owner/work. Each node clip supplies `fileId` and `mediaVersionId`. The server checks ownership, work, exact version, confirmed upload, actual object checksum, verified duration and immutable confirmation hash, then persists immutable asset pins. It never substitutes the newest file/version.
- Common intro file + separate B file + separate C file is the baseline synthetic fixture. Nodes can also reuse different offsets in one pinned file. Tests' storage/probe doubles are explicitly not proof of real movies or ffprobe output.
- No story tables, novel text, external manuscript, provider calls, payment or public media grant is involved.

## Graph DTO

`POST /api/v1/me/ott-media/works/:workId/playback-manifests`

Header `Idempotency-Key` is required: 8-100 ASCII letters, digits, `_` or `-`. The same owner's exact normalized payload/work replay returns the original manifest; reuse for another payload/work conflicts. JSON body has only `graph`:

```ts
type Locale = 'ko' | 'en' | 'ja' | 'zh-Hans' | 'zh-Hant';
type Label = Partial<Record<Locale, string>>;
type Graph = {
  entryNodeKey: string;
  nodes: Array<{
    key: string;
    clip: null | { fileId: string; mediaVersionId: string; startMs: number; endMs: number };
    choices: Array<{ key: string; label: Label; targetNodeKey: string }>;
    ending: null | { key: string; label: Label };
    rejoin: boolean;
  }>;
};
```

- Node, choice and ending keys use 1-80 ASCII letters/digits/`_`/`-`. Labels are optional per locale, nonempty plain text when supplied, at most 200 characters. Unknown object properties and unsupported locales are rejected, not silently removed.
- Maximum 128 nodes and 16 distinct source files, at most 64 MiB per file and **256 MiB total distinct-file bytes** for create/pin/full-readiness validation. The aggregate is checked from immutable confirmed metadata before any object I/O; exceeding it returns `OTT_INVALID`. This is a supported asset limit, not a claim of 15-minute playback capacity. DAG only. All nodes must be reachable from the entry. Every finite path ends at an explicit ending; cycles, duplicate node/ending keys and nonexistent targets are rejected. Non-ending nodes require 1-3 unique authored choices; terminal nodes require zero choices and an ending. No freeform choice input.
- Any multiply referenced target must explicitly declare `rejoin: true`. The server never inserts or forces a rejoin. Two differently authored choices may remain separate through different endings.
- Offsets are integer milliseconds on the original source-file timeline, with `0 <= startMs < endMs <= verified duration`. They are not clip-relative or based on declared duration alone.
- `clip: null` is an explicit unmade/missing asset. Missing labels and clips can be saved in an immutable draft, but cannot be pinned as ready for an affected locale. A provided file reference must already be valid/confirmed; expired unconfirmed uploads are rejected, not accepted as missing placeholders.
- Draft revisions are immutable snapshots. Editing creates another revision; no PATCH/rebase endpoint exists.

Create/get response:

```ts
{
  manifestId, workId, graphRevision, checksum, graph, visibility: 'private',
  readiness: {
    previewReadyByLocale: { ko, en, ja, 'zh-Hans': boolean, 'zh-Hant': boolean },
    fiveLocaleReady: boolean,
    issues: Array<{ code: string; nodeKey?: string; choiceKey?: string; locale?: Locale }>,
    publication: 'not_authorized'
  }
  // Creation additionally returns idempotentReplay: boolean.
}
```

The checksum binds the normalized graph and all server-derived source pins, not caller-supplied hashes. No storage path, cookie value, signing material, user IDs or public URL appears in graph/progress responses.

## Readiness and Preview Pinning

- `GET /works/:workId/playback-manifests?limit=20&cursor=:manifestId` lists newest graph revision first. Limit 1-50. The cursor must belong to the same owner/work. Returns `{items:[{manifestId,graphRevision,checksum,createdAt,validation:'not_checked',visibility:'private'}],nextCursor:string|null}`. Listing does not claim current asset readiness.
- `GET /playback-manifests/:manifestId` is the explicit **full-readiness check**: it returns the graph and recomputed readiness, rechecking all referenced original objects within the aggregate byte limit. It is not a periodic progress-poll endpoint. Issue codes: `clip_missing`, `media_not_confirmed`, `clip_out_of_bounds`, `choice_translation_missing`, `ending_translation_missing`, `subtitle_missing`, `media_revoked`, `media_unavailable`.
- `POST /playback-manifests/:manifestId/preview-pins` body `{locale}` pins one immutable owner-private preview per graph/locale, naturally idempotent. Returns `{previewId,manifestId,graphRevision,checksum,locale,visibility:'private',publication:'not_authorized',idempotentReplay,readiness}`.
- A locale is owner-preview-ready only when every referenced clip is available and all choices/endings have that locale's authored label. Missing subtitles do **not** block the author's own preview: they remain explicit `subtitle_missing` issues and absent tracks. The existing nonempty cue-track validation is preserved; no empty/generated subtitle track is invented for a silent clip.
- `fiveLocaleReady` additionally requires all five label locales and confirmed subtitle tracks on every source file. It checks provided localization assets, not semantic translation quality, language detection or whether a particular interval contains dialogue/cues. It is **not** permission to publish. `publication` always remains `not_authorized`.
- Creation, pinning (including pin replay), and explicit full-readiness reads check all referenced bytes. Their readiness is a point-in-time observation, not a cached authorization for later delivery.

All abbreviated endpoint paths above and below are relative to `/api/v1/me/ott-media`.

## Personal Progress

- `POST /playback-previews/:previewId/progress`, body `{}`: start at entry/clip start, or resume the unique existing progress for this owner and preview. Does not reset/rebase completed or older progress.
- `GET /playback-progress/:progressId`: revalidate all referenced DB pins/ownership/confirmation/revocation and the current scene's actual bytes, then return current-scene availability. Graph/locale remain pinned for this progress, even after a newer graph is created. This response does not contain or imply freshly verified whole-graph health or `fiveLocaleReady`.
- `POST /playback-progress/:progressId/choices`, required `Idempotency-Key`, body `{manifestId,expectedRevision,nodeKey,choiceKey}`. The server finds the authored choice at the actual current node and resolves its target. Caller target, file/version override, freeform text and old revision fail closed. No user-supplied destination is accepted.
- `PUT /playback-progress/:progressId/position`, required `Idempotency-Key`, body `{manifestId,expectedRevision,nodeKey,positionMs}`. Saves integer source-file milliseconds within the current clip, increments revision. It checks all referenced DB pins and revocations, but **does not read/hash bytes or authorize new bytes**; the response explicitly says `validation.bytes:'not_checked'`. Position at an ending clip's end marks `completed`; seeking back within that clip returns `active`. Choice entry starts at the target clip's start with `active` status. No new forced 60-second save interval or global byte-budget table is introduced.
- Start/resume/read checks the current scene's bytes (at most one 64 MiB source); choice checks current and target bytes before updating progress (at most two distinct 64 MiB sources; one read if both nodes reuse a file). Every progress operation still immediately checks **all** referenced owner/work/version/checksum/duration/confirmation pins, status and revocations. A revoked unvisited reference blocks every progress operation, including saves and retries.
- **Explicit lazy off-path byte-damage policy:** deletion or changed bytes in an unvisited source do not block healthy current-scene reads or metadata-only saves. They block a transition into that source before progress/receipt mutation, and the explicit full-readiness check reports the graph unready. A changed current source blocks fresh start/read/choice and session/delivery, but not a metadata-only position save. This is deliberate, not a claim that all graph bytes were just verified. No mtime/fingerprint checksum cache is used.
- Choices are available at the current node; this private author-preview slice does not enforce viewing every frame before selection. It is not a paid/public watch-completion policy.
- Owner/progress row locks serialize concurrent operations. Two different commands using the same expected revision cannot both apply. A save-versus-choice loser gets `OTT_CONFLICT`; the client fetches current progress before another action.
- Command receipts append the validated request (including authored choice key), applied state and from/to revision separately from the shared immutable manifest. Same-key identical replay returns the **original applied state** with `idempotentReplay:true`, even if later commands advanced progress. Clients must not replace a newer local revision with an older replay receipt; GET returns current state. Cross-command/cross-progress key reuse conflicts. Replays still check all referenced DB pins/revocations; choice replay checks current and returned receipt scene bytes, while position replay remains metadata-only.

Progress response (start/read/choice/save):

```ts
{
  progressId, previewId, manifestId, graphRevision, locale,
  revision, status: 'active' | 'completed', positionMs, idempotentReplay,
  visibility: 'private', source: 'authored_uploaded_clips',
  validation: {
    allReferencedPins: 'valid',
    bytes: 'current_scene' | 'current_and_target' | 'not_checked',
    wholeGraphBytes: 'not_checked'
  },
  node: {
    key, clip: {fileId,mediaVersionId,startMs,endMs},
    choices: [{key,label: string}], ending: null | {key,label: string}
  },
  subtitles: [{locale,status:'available',cues:[{startMs,endMs,text}]}],
  availableSubtitleLocales: Locale[],
  browserPlayback: {
    sessionPath: '/api/v1/me/ott-media/files/<fileId>/playback-session',
    method: 'POST', mode: 'secure_http_only_cookie'
  }
}
```

Subtitle cue timestamps stay on the original file timeline and are intersected with the node's clip interval; text is unchanged. Available tracks are exactly confirmed source tracks, not machine translations. Missing tracks are omitted. All five locales are preserved when provided.

## Browser Playback and Revocation

Use the existing owner-authenticated playback-session POST (`{}`) at the returned path. It sets the existing owner/file/version/checksum-bound HttpOnly Secure cookie; only the existing browser media path and expiry are returned. The browser uses its native range request with the cookie. Graph/progress endpoints never mint public URLs, return raw tokens or broaden access to another owner. HTTPS/same-site and existing origin policies still apply.

The media response is the **whole authorized source file**, not a transcoded or byte-restricted clip. The author player seeks to `startMs`, stops/offers choices at `endMs`, and switches files only from the server's returned node. The server bounds stored positions and authored transitions; this owner-preview is not a DRM clip-access boundary.

`POST /files/:fileId/revoke`, body `{}`, returns `{fileId,revoked:true}`. One-way and idempotent; it appends an immutable revocation record without altering confirmed upload bytes/subtitles. It blocks further upload/confirmation replay, new and existing delivery requests for that file, preview pins and graph progress that depend on it (even off-path). Standalone owner preview of another unrevoked file is still independent of graphs. There is no restore/publication endpoint. Historical graph/progress records remain immutable/pinned, not silently repointed.

Graph operations hold shared locks on all referenced upload rows through their transaction; revoke and per-file session/delivery validation hold an exclusive upload-row lock. Locks serialize eligibility against revocation, not physical filesystem mutation. If an operation gets its lock first, it can commit before revocation; if revocation commits first, the next operation reads the revocation and rejects. SQL guards use the same source locks for immutable pins, preview sealing and progress updates. Delivery hands an already authorized/opened file handle out after its validation transaction commits. Revocation cannot recall that in-flight handle/stream, even if some bytes are sent afterward; new range/session/delivery requests recheck and reject. No stronger stream-cancellation guarantee is claimed.

Success responses use `Cache-Control: private, no-store`. The existing five-locale error envelope is reused: malformed graph/input 400 `OTT_INVALID`, foreign/missing scope 404 `OTT_NOT_FOUND`, stale/key conflict 409 `OTT_CONFLICT`, unavailable graph/media 409 `OTT_NOT_READY`, expired unconfirmed upload 410 `OTT_EXPIRED`. Raw DB/storage diagnostics are not returned.

## Implementation and Validation Boundaries

- Additive migration `20260922200000_ott_authored_playback`: compound owner/work/version FKs, immutable manifests/pins/previews/receipts/revocations, unique owner-scoped request receipts, unique preview progress, revision/position/transition/completion guards. No existing one-upload-per-version constraint removed.
- Full authoring validation reads at most 256 MiB across up to 16 files. Frequent progress reads hash only the current file (64 MiB maximum), choices at most current plus target (128 MiB maximum), and position saves perform no object I/O. All still check every referenced DB pin/revocation. Session and actual delivery independently rehash their own file. These are per-request bounds, not production throughput or end-to-end movie-capacity evidence. No background generation/transcoding/worker is added.
- Dedicated synthetic PostgreSQL suite requires `OTT_PLAYBACK_TEST_DATABASE_URL` in the environment only and refuses a host/port/database/user other than the allocated isolated QA target. It retains append-only synthetic fixtures and never disables constraints/triggers to clean up.
- Source tests cover separate intro/B/C assets, explicit rejoin, locale/subtitle readiness, missing media, owner/work/version isolation, graph validation, immutable PostgreSQL constraints, idempotent/concurrent operations, stale graph/progress, source revocation/changed/deleted bytes, and private HTTP controller flow. Existing OTT cookie/range tests cover grant invalidation.
- UI, actual uploaded branch films, generated unknown branches, public release, payments, production capacity and full-movie/media quality are outside this source slice.
