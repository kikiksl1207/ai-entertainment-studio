# Semantic Analysis Offline Source Metrics

Recorded 2026-09-22 using the planner in candidate `8ec53da` and its unchanged CLI
at `4cfc075`. Four modes ran sequentially with this worktree's physical dependencies
and E-drive temporary/cache paths. All processes exited0. No DB, application,
Jest, provider request, API key or manuscript upload was used. Only counts/hashes
were printed or recorded. Both authoritative Markdown files remained unchanged.

## Scope

- `body`: the existing converted intake JSON's BODY projection, validated by the
  current intake parser. Source/payload hashes match the existing intake report;
  all projected quotes occur in authoritative source order. This excludes material
  such as choices, metadata and blank blocks. It is NOT whole-Markdown coverage.
- `lossless-paste`: a hypothetical full-source projection using the existing paste
  parser per part, including blank lines and preamble. Its generated local boundary
  manifest is NOT author approval and was never uploaded. Concatenated planned
  text hashes equal the authoritative raw-file hashes, with complete original
  UTF-16 spans and no surrogate splitting, gaps, duplication or truncation.
- `sourceLocale` remains `ko` in all modes. There is no translation or reader locale.

## Planner Measurements

Times include process startup, source validation and local tokenization. Their sum
is129.220s; they are not provider latency measurements. All rows have exact coverage
of THEIR OWN scope and unchanged source hash/mtime. Tiny means a nonempty chunk
with fewer than256 non-whitespace UTF-16 units; empty-only means no non-whitespace
text at all. Empty paragraphs were retained, not dropped to improve these counts.

| Mode | Seconds | Parts | Paragraphs Covered / Total | Chunks | Full Framed Input Tokens | Tiny Chunks | Empty-Only Chunks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Imjin body | 13.601 | 75 | 19,537 / 19,537 | 611 | 1,747,054 | 0 | 0 |
| Norse body | 37.231 | 216 | 104,036 / 104,036 | 3,252 | 8,546,421 | 1 | 0 |
| Imjin lossless-paste | 17.727 | 75 | 48,953 / 48,953 | 1,530 | 3,903,508 | 49 | 0 |
| Norse lossless-paste | 60.661 | 216 | 218,961 / 218,961 | 6,843 | 16,275,672 | 793 | 0 |

| Mode | Projected UTF-16 Units | Min / Max Text Units Per Chunk | Current Intake Supported |
| --- | ---: | ---: | --- |
| Imjin body | 808,024 | 673 / 2,708 | true |
| Norse body | 3,382,044 | 246 / 2,819 | true |
| Imjin lossless-paste | 1,210,940 | 265 / 2,016 | true, hypothetical boundaries only |
| Norse lossless-paste | 4,004,175 | 176 / 2,579 | **false: total-paragraph limit** |

The raw Imjin source has48,953 line paragraphs including22,593 blank ones; raw
Norse has218,961 including106,857 blank ones. Norse exceeds the current complete
intake cap of200,000 paragraphs, even though its BODY projection is accepted.
The per-part offline calculation does not relax that cap or prove a successful
whole-source admission. No intake or packaging code was changed for this report.

## Tokens and Illustrative Reservation

Tokenizer: pinned `js-tiktoken@1.0.21`, `o200k_base`, configured local counting model
`gpt-4o-mini-2024-07-18`. Full framed input is the sum of local token counts for the
entire serialized request, including instructions, schema, source refs/text and
other request fields. It is NOT just manuscript text tokens or measured API usage.
The input reservation adds `ceil(tokens * 1.1) + 256` separately for every chunk.

The CLI's explicit ILLUSTRATIVE pins are8192 input tokens/chunk,2048 output
tokens/chunk including reasoning,10,000,000 job input tokens,10,000,000 job output
tokens and100,000 KRW job reservation. Example rates are1000 input /500 cached-input
/2000 output KRW per million tokens. These are not current vendor price quotes,
production rate-card values or actual charges. Reservation assumes uncached input
and full allowed output, plus0.000001 KRW/chunk for rounding. No output was generated.

| Mode | Buffered Input Reservation | Output Reservation | Illustrative Reserved KRW | Illustrative Whole-Job Cap |
| --- | ---: | ---: | ---: | --- |
| Imjin body | 2,078,510 | 1,251,328 | 4581.166611 | supported |
| Norse body | 10,235,214 | 6,660,096 | 23555.409252 | **exceeded: input** |
| Imjin lossless-paste | 4,686,308 | 3,133,440 | 10953.18953 | supported |
| Norse lossless-paste | 19,658,179 | 14,014,464 | 47687.113843 | **exceeded: input and output** |

These are complete local planning simulations, not queued production jobs. Under
these illustrative caps the worker would reject the Norse jobs before first
dispatch; the synthetic PG suite separately verifies that before-dispatch bound.
Production admission is UNKNOWN until its actual pinned configuration/rate card
is supplied and checked. No production settings or caps were read, raised or enabled.
This is not a company-global budget guarantee. A terminal zero-dispatch budget
failure is still NOT user-recoverable in this candidate; see the handoff's separate
known-zero-dispatch recovery gap versus paid-unknown reconciliation requirement.

The32-piece packaging ceiling yields thousands of planned chunks for Norse even
though most BODY chunks are not tiny by the stated threshold. If a future approved
budget permitted execution, each chunk would currently require its own provider
request. This report quantifies that overhead; it does not optimize packaging,
delete blank paragraphs, silently truncate text or pretend an over-cap book fits.

## Hashes

Only digests are stored here. Imjin source bytes:2,734,895. Norse source bytes:9,420,231.

| Source / Projection | SHA-256 |
| --- | --- |
| Imjin authoritative raw; also reconstructed lossless text | `34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125` |
| Imjin converted intake JSON | `d6153f69ffa9689c9c1453854f3401d49612d46f7e8614ad26c893ce30ec2995` |
| Imjin concatenated body-only text | `38fc84b4292dce18a67ac4c01ea1adeddcc668979b311e729101280d0c5f3a38` |
| Norse authoritative raw; also reconstructed lossless text | `612df5a9cdc5d966631ae1899dfa6ae3f870c14d242fbb7b545dc69b78def560` |
| Norse converted intake JSON | `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8` |
| Norse concatenated body-only text | `e75b4a512827d305f1b36c70fd53026b5ad023cf686ddc6c12b776f52e338213` |

## Reproduction and Limits

From this candidate's `server` directory, run separately and sequentially:

```text
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse body
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts imjin lossless-paste
node -r ts-node/register/transpile-only scripts/verify-semantic-source-coverage.ts norse lossless-paste
```

The safe local JSON reports are in `E:/CodexMovedCache/tmp/semantic-planner-` with
suffixes `imjin-body.json`, `norse-body.json`, `imjin-lossless.json` and
`norse-lossless.json`. They contain no manuscript text. Timings were measured by a
PowerShell Stopwatch around each process. Test counts remain7 suites/67 PASS;
these four CLI runs are not four additional Jest tests.

Validated: deterministic source-span coverage, hashes, framing-aware token planning,
fragmentation counts and illustrative cap comparison. NOT validated: semantic
observation truth/quality, cross-book memory/style quality, provider latency,
translation, approved author review, #1855 whole writer UI flow or live paid
readiness. Provider and worker flags remain OFF. This report changes neither
admission nor packaging; any follow-up requires a separately reviewed bounded
change. The #1896 length/deadline work remains isolated from those changes.
