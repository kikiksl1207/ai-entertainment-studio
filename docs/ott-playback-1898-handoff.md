# #1898 Backend Candidate Handoff

Base: PM `29e07725067277417b890ac44bb8a163496bbfbf`. Branch: `codex/kaido-1898-ott-branch-20260922`.

Frontend contract: [ott-playback-1898-contract.md](ott-playback-1898-contract.md). This is an owner-private authored playback API, not public publication or generated media.

## Implemented

- Immutable compound graph revisions assemble distinct same-owner/work confirmed source file versions. Intro/B/C use separate files in synthetic fixtures; existing single-upload-per-source-version constraint remains.
- Explicit DAG destinations, localized authored choices (1-3), declared rejoins and terminal endings; missing clips/translations remain unready. Locale-ready author preview does not invent missing subtitle tracks or confer publication authority.
- Owner-bound preview pins and personal progress; revision-checked transitions/position saves and append-only exact-request receipts. Source-revocation locks serialize against pin/progress/delivery authorization.
- All referenced DB ownership/pins/revocations are checked on every progress operation. Start/read verifies current bytes, choice verifies current plus target, position save does no object I/O and says so. Off-path physical damage is detected before entry, not on unrelated healthy-scene reads/saves. Full graph creation/pin/readiness is limited to 256 MiB before I/O; source files remain at most 64 MiB each, graph at most 128 nodes/16 files.
- Existing owner HttpOnly cookie/range media paths remain independent and rehash actual delivery bytes. A one-way revocation blocks new requests for the file and every dependent graph's progress. Already authorized/opened streams cannot be recalled.

## Validation

Executed sequentially with own physical dependencies and exact E-drive Node. No old dependency junction/copy, frozen route checkout/DB access, live provider, payment, public publication, or deployment.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 746 packages, 27 seconds |
| Own Prisma client generate | PASS, v6.19.3 |
| `tsc --noEmit --incremental false` | PASS |
| Fresh migration deploy | 63 applied, 0 unfinished; includes `20260922200000_ott_authored_playback` |
| Focused Jest `ott-(media\|playback)`, `--runInBand` | 10 suites PASS, 1 optional suite SKIP; 134 PASS, 2 SKIP, 0 FAIL; 57.389 seconds |
| Actual PostgreSQL subset | 32 PASS: 20 service/constraint, 11 lock-order, 1 controller HTTP |
| Focused ESLint | PASS |

Skipped tests are the two pre-existing duration-probe tests requiring explicit ffprobe and playable fixture environment settings. Existing storage, cookie/range HTTP, revocation, validation and repository regressions ran. Probe/storage doubles in new graph fixtures are explicit; synthetic bytes are not playable films. No 15-minute movie, encode quality, browser branch UI, production throughput, or full repository-suite claim is made.

Initial tsc found two DTO union-narrowing errors, corrected before the passing tsc/Jest run. No unresolved execution failure remains in the tested OTT scope.

Dedicated synthetic DB `lumina_ott_branch_qa`: 34 works, 106 uploads, 31 manifests, 30 preview pins, 27 progress rows, 24 command receipts, 15 revocations after the run. Zero disabled user triggers and zero other connections at close. Append-only fixtures retained; no reset/constraint bypass. Connection URL was environment-only and is not saved here.

Heavy phase (including finishing agreed source edits) was 20:35:24-20:46:16 UTC, 10m52s. All processes exited and the heavy slot was returned before documentation/commit cleanup. Future work/review must request its own heavy slot; this candidate does not start #1854 or the independent Imjin ending correction.

## Review Boundaries

- Review `ott-playback.contract.ts`, `ott-playback.service.ts`, controller/module, the additive migration, and narrow OTT metadata/revocation integration. No story/economics/settlement/provider implementation changed.
- The server resolves the authored target; the player must not send a destination override. Retried command receipts can be older than current progress: ignore older revisions locally and use GET for current state.
- Progress `validation.wholeGraphBytes` is always `not_checked`; never display full readiness from progress or reuse an earlier `fiveLocaleReady` as fresh whole-graph health. Full graph readiness is an explicit authoring read, not periodic playback polling.
- Retain existing cookie HTTPS/origin controls. The file stream is owner-authorized whole-file content; clip bounds constrain authored transitions and stored position, not DRM access to file bytes.
