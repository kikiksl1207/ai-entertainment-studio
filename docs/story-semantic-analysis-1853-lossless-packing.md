# Lossless Paste and Bounded Packing (#1853 Follow-up)

Validated candidate on base `65bb0a8`: 11 focused suites, 186 PASS / 0 FAIL /
0 SKIP, plus all four actual-source offline modes. All first executions passed;
there was no failing product code or test fixture to repair. Provider and worker
paid flags remain OFF. No source has been sent to a provider, and this change
makes no model-quality or full production-readiness claim.

The frozen extraction/metrics branch is backed up at `0605980` (includes `8ec53da`
and `4cfc075`). Its 67 passing focused tests and four offline runs describe that
older candidate, not this follow-up. The 32-piece baseline required 6843 chunks
and 16275672 framed input tokens for hypothetical lossless raw Norse; actual
provider calls were zero. Baseline raw Norse admission was false at 218961 line
paragraphs against the unchanged 200000 cap. Measured v4 raw Norse admission is
now true at 112104 lossless paragraphs; this is a local hypothetical intake check,
not an author-confirmed upload or an authorization to generate.

## Paste Identity and Replay

- Only `utf8_paste` segmentation changes. JSON-file and existing JSON DTO
  paragraphs, identity v2, and legacy locale-aware replay behavior are untouched.
- Blank means an original line containing only space, tab, CR or LF. Classification
  does not trim or rewrite text. Blank lines attach to the previous paragraph when
  space permits; leading blank lines may prefix the first content paragraph.
  Separate nonblank lines are never joined to each other. Overflow remains as
  additional paragraphs; no blank text is discarded.
- Every paragraph stays <=10000 UTF-16 units without splitting a surrogate pair.
  No text crosses confirmed part boundaries. Rejoining paragraph texts yields the
  exact uploaded UTF-8 bytes, including BOM, line endings and trailing whitespace.
- All byte, manifest, part, per-part (5000), whole-book (200000), and stored-body
  limits are unchanged. Coalescing is not permission to lift these limits.
- New paste identity is v4: hash `{identityVersion:4,locale,parts,sourceSha256}`.
  Raw source SHA remains the byte identity. Old v3 rows, source hashes, paragraph
  indices, release references and citation offsets are never rewritten. Semantic
  source validation accepts both explicit v3 and v4 hash formulas; unsupported
  identity versions cannot fall through to a legacy checksum.
- An explicit upload under v4 creates a new hash/version relative to old v3 even
  when the raw bytes are identical. Repeated v4 uploads replay that new version;
  the existing locked store/unique constraints also cover concurrent uploads.
  No analysis job is automatically queued by intake. Clients must bind subsequent
  actions to the receipt's version/hash, not assume raw SHA identifies a version.
- This parser-version transition is NOT a sanctioned failed-analysis recovery
  operation. The old job/fence/reservation stays intact. Do not recommend new
  uploads or new keys as a workaround for unknown paid outcomes. Same-version
  zero-dispatch recovery and paid reconciliation remain separate unfinished work.

## Pinned Planner Compatibility

New jobs store `packingProfile: "framed_256_v1"` in existing `configPins`; the field
is included in `configHash`. It is a server implementation pin, not a new client or
environment option. No schema, migration, dependency or rate-card change is needed.

Absent profile means the exact existing 32-piece planner, including its old
character target and halving rules. `semanticPins` does not insert a default into
an old record or change its old hash. Queued and partially planned legacy jobs can
resume with the new worker; persisted old chunks are neither replaced nor dropped.
The runtime comparison selects ONLY the supported job-pinned planner. Provider,
model, rate-card ID/version, all rates, per-chunk limits, and all aggregate budgets
must still match runtime config exactly. Both saved pins and their saved hash are
checked. Unknown/null/empty profiles fail before paid dispatch. `analysisVersion`
retains its existing job-version meaning and is not used as a planner selector.

The new profile gathers at most 256 pieces and 12000 UTF-16 text units. It measures
the complete serialized request, including instructions, strict schema, source
refs and framing, using the existing pinned local tokenizer plus 10%+256 buffer.
If the candidate is over budget, at most eight prefix probes choose a measured
fitting prefix. A single oversized paragraph may use at most fourteen additional
surrogate-safe offset probes. Only an actually measured fitting result is accepted;
token counts are not assumed perfectly monotone and mathematically optimal packing
is not claimed. There is no network token counting or arbitrary source truncation.

Empty paragraph refs, order, cursors, checksums and completed-paragraph accounting
are preserved. Output cap, <=64 candidate observations per response, whole-job
reservation before first dispatch, per-transaction limits and durable dispatch
fences are unchanged. Fewer requests do NOT prove equal evidence recall or better
semantic/style quality. Full source coverage is not author approval, verified
interpretation, cross-book memory quality or translation.

## Verification

Source tests cover mixed newlines/BOM, leading and long blank runs, 10k surrogate
edges, confirmed part boundaries, unchanged caps, unchanged JSON, and concurrent
v4 replay with preserved v3 citation coordinates. Config/planner tests cover exact
legacy hashes/32-piece refs, all non-planner pin mismatches, rejected profiles,
bounded prefix probes, full framing, empty refs, checksums and resumable cursors.

Guarded disposable PG tests use the actual new `executeOne` path for BOTH an old
queued job and an old partially planned job with no profile. They assert planning
still yields `[32,32,32,32,2]` for the fixture, unchanged prior pins/chunk/source,
and a 32-piece fake transport dispatch. Other cases exercise v3/v4 source/citation
validation, unknown identities/profiles, aggregate rejection before first call,
and the existing unknown-outcome fences. Both legacy-resume cases passed using
the actual new worker/service path and real PostgreSQL with fake transport.

The four commands were run sequentially, with no DB/app/Jest overlap:

```text
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin lossless-paste
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse lossless-paste
```

An optional final `legacy_32` argument measures the old planner on the CURRENT
parser representation; it does not recreate the old v3 intake. The frozen baseline
remains authoritative for the old v3/32-piece combination.

The updated CLI attempts whole-book paste parsing and stored-body size validation,
not just per-part parsing, before reporting `currentIntakeSupported:true`. A
size-rejected hypothetical run is explicitly marked unsupported. Reports contain
only counts/hashes: raw lines/blanks, v4 paragraphs, time, chunks, accepted full
framed tokens, buffered reservation, tiny/blank chunks, probe counts and coverage.
Body projection is NEVER described as full raw coverage. The auto-derived manifest
is offline-only and not author-confirmed. Illustrative job caps/rates are unchanged;
production affordability remains unknown, even if raw intake becomes admissible.

### Dependency, Database and Test Results (2026-09-22)

All commands used own physical E-drive dependencies/client, with TEMP, TMP,
TMPDIR, npm cache, Node cache and Jest cache on E. No PM/donor client was generated
or changed. `npm ci --ignore-scripts` installed 746 packages in 41.964 seconds;
package and lockfile are unchanged. Own Prisma 6.19.3 generate/validate passed.
Whole-server `tsc --noEmit --incremental false` passed first run in 26.697 seconds.

Read-only history checks found 63 applied migrations in the retained
`lumina_analysis_qa` database. Its only difference from source64 is
`20260922200000_ott_authored_playback`. No reset, drop, migration, or fixture
cleanup was performed there. A new absent `lumina_analysis_packing_qa` database
was created and all 64 migrations applied in 8.660 seconds. This follow-up's PG
and AppModule specs now reject any other database name before connecting; cleanup
also checks `current_database()`. The guard change was intentional before the
first run, not a response to a test failure. No new migration/schema is added.

| Focused group | Suites | PASS | FAIL | SKIP | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Intake policy, planner, config | 3 | 70 | 0 | 0 | 37.286 |
| Version store and intake controller | 2 | 47 | 0 | 0 | 23.495 |
| Provider, projection, lifecycle, continuity | 4 | 44 | 0 | 0 | 15.597 |
| Actual isolated PostgreSQL, fake transport | 1 | 24 | 0 | 0 | 72.655 |
| Full AppModule defaults-OFF | 1 | 1 | 0 | 0 | 25.724 |
| Total | 11 | 186 | 0 | 0 | 174.757 |

AppModule boot required no semantic/continuation key/model/rate-card settings,
returned local health 200, and closed cleanly with zero external fetches. These
tests do not replace PM's authenticated real writer HTTP or independent review.
First-run logs/JSON are retained outside Git under
`E:/CodexMovedCache/tmp/semantic-packing-{core,intake,regression,postgres,app}-first.*`.

### Actual Offline Results

`body` is the existing converted body projection, not the full raw manuscript.
`raw` below means the lossless-paste mode with a hypothetical local part manifest.
Whole-book parser and stored-body size validation passed for both v4 raw books.
All four scopes have exact ordered coverage, unchanged source SHA/mtime, source
locale `ko`, no surrogate splits, and zero provider calls. No raw text was written
to Git/console/reports. Every new mode has zero tiny and zero empty-only chunks.

| Scope | Parts | Paragraphs, old -> new | Chunks, old -> new | Full framed input tokens, old -> new |
| --- | ---: | --- | --- | --- |
| Imjin body | 75 | 19537 -> 19537 | 611 -> 195 | 1747054 -> 1397198 |
| Norse body | 216 | 104036 -> 104036 | 3252 -> 919 | 8546421 -> 6598366 |
| Imjin raw | 75 | 48953 -> 26360 | 1530 -> 289 | 3903508 -> 2068590 |
| Norse raw | 216 | 218961 -> 112104 | 6843 -> 1068 | 16275672 -> 7663197 |

The physical raw sources remain 48953 lines / 22593 blank lines for Imjin and
218961 / 106857 for Norse. No line/metadata/choice was deleted: v4 attaches blank
text losslessly. The full 1210940 UTF-16 units / 2734895 bytes (Imjin) and 4004175
units / 9420231 bytes (Norse) are reconstructed. Raw Norse's unchanged 200000
paragraph cap now admits the v4 representation. Old v3 source rows/citations are
not transformed. The new content identities are distinct from both v3 and body v2.

| Scope | Buffered input reservation | Output reservation | Illustrative KRW reservation | Illustrative whole-job cap |
| --- | ---: | ---: | ---: | --- |
| Imjin body | 1586943 | 399360 | 2385.663195 | true |
| Norse body | 7493969 | 1882112 | 11258.193919 | true |
| Imjin raw | 2349596 | 591872 | 3533.340289 | true |
| Norse raw | 8703521 | 2187264 | 13078.050068 | true |

These are unchanged illustrative pins: dated model `gpt-4o-mini-2024-07-18`,
`js-tiktoken` 1.0.21 / `o200k_base`, per-request input 8192 / output 2048, whole-job
input 10000000 / output 10000000 / cost 100000 KRW, and input/cached/output rates
1000/500/2000 KRW per million. They are NOT current provider prices, actual usage,
or production authorization. Full framed input includes schema/instructions; the
reservation adds `ceil(tokens * 1.1) + 256` per accepted request. Output includes
reasoning. Production affordability remains UNKNOWN. An actually configured cap
can still reject any book before its first dispatch; no cap was raised here.

| Scope | Process wall seconds, old -> new | New planner probes | Max pieces | Text units per chunk, min..max | Tiny chunks, old -> new |
| --- | --- | ---: | ---: | --- | --- |
| Imjin body | 13.601 -> 67.846 | 1740 | 119 | 3099..5403 | 0 -> 0 |
| Norse body | 37.231 -> 284.092 | 8261 | 133 | 2522..5350 | 1 -> 0 |
| Imjin raw | 17.727 -> 97.713 | 2578 | 112 | 2845..5408 | 49 -> 0 |
| Norse raw | 60.661 -> 324.158 | 9594 | 126 | 1103..5948 | 793 -> 0 |

Total process wall time increased from 129.220 to 773.809 seconds. This is an
explicit CPU tradeoff, not a speed improvement: bounded prefix fitting repeatedly
tokenizes framed requests, and the offline CLI independently verifies the final
accepted request rather than counting a possibly rejected last probe. Tiny means
nonempty text with fewer than 256 non-whitespace UTF-16 units; empty-only counts
are zero both before and after. Offline time is NOT provider latency. Fewer, larger
requests do not establish equivalent observation recall or author-style quality.

| Hash purpose | SHA-256 |
| --- | --- |
| Imjin raw bytes = reconstructed full raw | `34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125` |
| Imjin existing intake JSON | `d6153f69ffa9689c9c1453854f3401d49612d46f7e8614ad26c893ce30ec2995` |
| Imjin body-only text | `38fc84b4292dce18a67ac4c01ea1adeddcc668979b311e729101280d0c5f3a38` |
| Imjin v4 content identity | `e3d9dd66de8def5187f0801d77fcaef6483790e1ca61c3bcc4cb24f84fe84207` |
| Norse raw bytes = reconstructed full raw | `612df5a9cdc5d966631ae1899dfa6ae3f870c14d242fbb7b545dc69b78def560` |
| Norse existing intake JSON | `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8` |
| Norse body-only text | `e75b4a512827d305f1b36c70fd53026b5ad023cf686ddc6c12b776f52e338213` |
| Norse v4 content identity | `f9dd41c8bb218dda9edef929ef03dcb5dd568c5d7576aa7bead8fd49c58a5807` |

First-run count/hash reports are retained outside Git under
`E:/CodexMovedCache/tmp/semantic-packing-{imjin,norse}-{body,lossless}-first.json`.
Every foreground command exited normally, final process inspection found no
matching Node process, and the heavy slot was returned BEFORE these documentation
updates and commit/push. No background app/server was left running.

## Remaining Boundaries

Independent review of the earlier extraction candidate and this follow-up remains
separate. Failed-job recovery, author-approved evidence/memory, frontend review,
semantic recall/style quality, translation and live provider latency are not
completed by these metrics. Both paid flags must stay OFF. Unknown dispatch still
retains its fence/reservation; no zero-cost claim or automatic retry was added.

#1896 author-anchored length/pacing/deadline investigation is next and is NOT mixed
into this commit. #1854/#1855 memory/UI work is also unchanged. Keep this candidate,
its own dependencies/client and the prior frozen worktree available for review;
do not mutate PM/donor dependencies or reset retained databases.
