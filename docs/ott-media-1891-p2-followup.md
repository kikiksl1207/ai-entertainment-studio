# OTT #1891: Two P2 Follow-Up Fixes

Original candidate remains `07354537900fc5428131f9140a3eefde4bcac3bd`, tree
`cc39c8603ebac8b9f95848943feb88ec49d3a3bb`, on its original origin branch.
Follow-up branch: `codex/kaido-1891-duration-private-headers-20260914`.
QR1 original reports, fixtures and tool files are read-only and preserved.

## Minimal Runtime Changes

- `ott-media.service.ts`: before probing, validate subtitle structure, text,
  counts, ordering and the existing global time bound rather than the unverified
  declared duration. The existing post-probe measured-duration check remains
  authoritative; confirmed replay still uses its persisted verified duration.
- `ott-media.controller.ts`: set private/no-store, Vary and same-site CORP before
  Range parsing. The existing `finally` closes the opened descriptor on 416.
  Content-Range and status behavior are unchanged. No global headers change.

No schema, migration, probe implementation, original-source behavior, UI,
dependencies, package scripts or shared modules changed.

## Regression Evidence (2026-09-14)

Before runtime edits: the newly strengthened service/HTTP tests reproduced the
two reported failures (20 PASS / 2 FAIL). Evidence:
`E:/CodexMovedCache/tmp/kaido-1891-p2/before-results.json`.

After runtime edits: direct exact-path Jest, runInBand, 7 suites / 89 tests PASS,
no skipped tests, 13.094 seconds. Evidence:
`E:/CodexMovedCache/tmp/kaido-1891-p2/after-results.json`.
`tsc -p src/ott-media/tsconfig.check.json --pretty false` also passed with the
existing config's noEmit enabled. No pretest, generate or build was run.

- Declared 1800 ms / actual 2000 ms / cue end 1900 ms: accepted.
- Declared 2200 ms / actual 2000 ms / cue end 2100 ms: rejected as OTT_INVALID,
  leaving uploaded state and no persisted verification.
- Invalid subtitle text is still rejected before object opening/probing.
- Cookie-authorized invalid Range: 416, Content-Range, private/no-store,
  `Vary: Origin, Authorization, Cookie`, same-site CORP, and exactly one real
  object open / one close invocation asserted through loopback HTTP.

Both timing cases ran with actual ffprobe, once each, against QR1's read-only
59,554-byte synthetic 2-second H.264/AAC fixture. Persistence remains a double;
HTTP authentication/probe remain doubles in the separate HTTP suite. These
results are not production DB or native-browser certification.

Actual-probe tests opt in through test-only process variables
`OTT_TEST_FFPROBE_PATH` and `OTT_TEST_DURATION_FIXTURE`. They do not set server
configuration. The fixture is read-only; copies and cleanup are confined to new
`ott-duration-*` directories under the author's explicit E TEMP root.

Tool: `E:/Codex/ffmpeg-9.0.1-essentials_build/ffmpeg-9.0.1-essentials_build/bin/ffprobe.exe`

Tool SHA-256: `19202b23c0043f15ad1b7bce2344f406fd52bd6efd8f995ce02e7392a1cec52f`

Fixture: `E:/CodexMovedCache/tmp/qr1-ott-0735453/fixtures/normal.mp4`

Fixture SHA-256: `5892d58c2e652717b1b16b2916effbd89330cd68033168b9b643232d154655c1`

The earlier unavailable-tool report is historical and unchanged; the supplied
verified tool became available under separate PM authorization. No additional
download, fixture generation, DB/provider call, main push or deployment occurred.
Independent QR1 acceptance of this follow-up SHA remains required.
