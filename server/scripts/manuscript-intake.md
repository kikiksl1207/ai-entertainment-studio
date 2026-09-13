# Offline Manuscript Preparation

This adapter prepares a private, deterministic local package. It cannot upload,
publish, call a provider, or write a database. Receipt persistence is not playable
story conversion. Exit 0 means preparation completed, **not** publish readiness.

## Execution

Python 3.10+ standard library only; CSV uses `csv`, JSON rejects duplicate keys.
No installed Markdown parser was found in the existing dependency manifests.
The adapter recognizes two bounded source dialects, not arbitrary CommonMark:
sectioned part files and `lumina-stage-story-v1` indexed part files. Unsupported
or incomplete structures fail closed. No dependency installation is needed.

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:TEMP='E:/CodexMovedCache/tmp'
$env:TMP=$env:TEMP
python -B server/scripts/manuscript_intake.py --config E:/private/input.json --output E:/private/derived/run-1
python -B -m unittest discover -s server/scripts -p test_manuscript_intake.py -v
node server/scripts/verify-manuscript-analysis-boundary.mjs E:/private/derived/run-1 E:/existing-server/node_modules
```

Run serially. The optional Node boundary check transpiles the current repository's
DTO and policy in memory, reusing an existing server's dependencies read-only. It
executes class-validator, the real analysis function, and body-parser against a
local Readable, without a socket, server, database, build, or provider call.

## Input Contract

Keep input configuration outside Git. Construct it from available package facts,
not from invented approvals or a request for the user to write metadata JSON.

```json
{
  "schemaVersion": "lumina-offline-input-v1",
  "profile": "sectioned-parts-v1",
  "sourceRoot": "E:/private/source",
  "primary": "service.md",
  "partsDirectory": "parts",
  "locale": "ko",
  "pricingMode": "free",
  "expected": { "parts": 2, "acts": 1, "choices": 6 },
  "pinnedHashes": { "service.md": "REPLACE_WITH_VERIFIED_SHA256" }
}
```

For `indexed-parts-v1`, also specify `manifest`, `partCsv`, and optionally
`checksumCsv`, as source-root-relative filenames. The manifest must use
`lumina-stage-story-v1` and contain its original `parts_index`. Optional
`externalHashes` entries have `path` and `sha256` (for separately stored ZIPs).
ZIPs are hashed without extraction. Filenames are configuration, not runtime
product constants. The sectioned dialect requires ordered `# Part N - title`,
body/choice sections and next-part markers; indexed sources support bracketed or
H3 scene markers, including scenes after a previous-choice summary without a body
heading. A/B/C may be adjacent without blank lines. Image prompt/directive lines
in design files and numbered inline image sections are counted separately;
alternative editions are not added together to manufacture a total.

The entire primary prefix before the first Part is retained in `primaryPreamble`
with exact segments and source spans. Permitted assembly blocks are blank space,
one H1 document title, volume headings, `---`, and the indexed dialect's exact
assembly-description form with the declared part count. Any other prefix content
is preserved as `unmapped` and blocks `primaryParagraphCoverage`, even when the
primary hash is valid. A/B/C labels without nonblank recommendation text block
`declaredStructure`; their raw text and evidence are still preserved.

## Output Contract

All output is private, including the raw source manifest and support text.
Never commit the artifacts or feed the whole package to a public reader.

| File | Meaning |
| --- | --- |
| `package.json` | Versioned lossless part segments, metadata/paragraph source spans, source inventory, original manifest, design evidence, authored choice labels, act/reset candidates, ending claims |
| `analysis-input.json` | One complete `{locale,parts}` projection for the existing manuscript analysis DTO; retains all parts even when the DTO cannot accept them |
| `report.json` | Counts, declarations vs observations, integrity hashes, source-line issues and separate readiness gates; no prose excerpts |
| `checksums.json` | Byte length and SHA-256 of each of the other three artifacts |

Each segment preserves its exact UTF-8 text including spaces, line endings and
BOM. `byteStart`/`byteEnd` are zero-based UTF-8 byte offsets, end-exclusive;
`lineStart`/`lineEnd` are one-based physical lines. Concatenating **all** segments
reconstructs the original part bytes. Paragraph references identify exact segment
slices; body text is not trimmed, translated, normalized or rewritten. Blank
separators and non-body metadata remain in the private package. Scene/background
markers are structural, not evidence of generated assets. Primary/individual
nonblank blocks are checked in both directions, allowing primary volume headings
and assembly separator rules, but not extra or missing narrative paragraphs.

Relative paths, file inventories, part/scene IDs, choice counts, A-route ordering,
target existence, encoding, CSV/JSON shape, pinned hashes and optional whole-file
checksum inventories are checked. Source inventories are hashed before and after
conversion. Output inside/above a source or inside Git is refused. Symlinks and
Windows reparse points (including Python 3.10 directory junctions) are checked
using `lstat` before directory descent or path resolution, including root/ancestor
and output paths; source traversal is refused. Existing output is accepted only if every byte
and filename already matches. A partial/interrupted directory is a conflict: use
a new output directory, never overwrite or clean source material.

Source A/B/C and full label text stay separate from `readerOrdinal` 1/2/3.
Only A has an authored-next-part **candidate**. B/C target fields stay null with
`ai_required_unresolved`; no unconditional convergence or invented scene is added.
That is expected AI-story product design, not a demand to rewrite all branches.
Ending provenance claims and eligibility conditions retain their source spans;
an AI-required ending is never labeled already AI-generated. Act entry candidates
are not runtime reset bindings. No approvals, prices, asset URLs or ready release
metadata are synthesized. Both free/paid retain max 3 recommendations and defer
custom choice. Genuine release/rights/paid-price decisions remain separate.

## Current Consumption Boundary

- `story-upload.service.ts` stores private files plus a `received` submission and
  receipt; only that service accesses `storyUploadSubmission` in runtime source.
  There is no intake-to-owned-work/manuscript import bridge proven by this code.
- `StoryProductionService.createManuscriptVersion` requires an existing owned
  work and stores `{parts}` as `structuredBody`. The analysis endpoint reads this
  separately; it produces evidence/continuity records, not published scene/choice
  graph materialization. Existing AI-generated scene persistence is not an
  authored-package importer.
- Current DTO limits: 150 parts, 5,000 paragraphs per part, 10,000 UTF-16 units per
  paragraph, 80 per part key and 240 per title. The report mirrors these limits;
  the Node verifier checks the actual class-validator DTO for drift.
- `main.ts` uses `NestFactory.create(...,{rawBody:true})` without a JSON limit
  override. Installed Nest Express registers body-parser JSON with its default
  `100kb` = **102,400 bytes**. The verifier proves local 413 rejection. Multipart
  intake's larger file limits do not change this separate JSON endpoint limit.
- `structured_body` is JSONB in migration 0048 and `Json` in Prisma. No separate
  small column constraint is declared. Database/driver/memory capacity is not
  established by offline serialization. `rawBody:true` also retains raw bytes.
- Manuscript creation and analysis use interactive transactions without local
  timeout overrides. Installed Prisma defaults are max-wait 2,000ms and timeout
  5,000ms. Analysis awaits one evidence create per record, then continuity writes;
  raising the part limit alone does not solve this ingestion path.
- Deployment docs describe Render, but no repository-controlled proxy body-size
  setting was found. Actual proxy/hosting limits remain unverified. No production
  probe or manuscript network transmission was performed.

## Actual Offline Audit: 2026-09-14

| Observation | Imjin | Norse |
| --- | ---: | ---: |
| Source files inventoried | 83 | 897 |
| Full part files preserved | 75 | 216 |
| Act/volume candidates | 5 | 11 |
| Explicit scene markers | 80 | 2,138 |
| Authored choices / AI-required B,C | 225 / 150 | 648 / 432 |
| Package checksum entries verified | No inventory supplied | 896 / 896 |
| Pinned primary/manifest + separate ZIP | 2 / 2 | 2 / 2 |
| Nonblank part blocks matched to primary | 22,833 | 107,014 |
| Reconstructed part bytes | 2,734,954 | 9,417,907 |
| Exact compact analysis JSON bytes | 2,547,918 | 11,466,327 |
| Exact `{parts}` JSON bytes | 2,547,904 | 11,466,313 |
| Analysis evidence records | 19,537 | 104,036 |
| Actual DTO result | Compatible shape | `parts:arrayMaxSize` |
| Local default JSON parser | 413 | 413 |
| Discovered/verified image files | 0 / 0 | 0 / 0 |

Norse declares and independently matches 216 parts, 11 acts, 2,138 scenes,
2,138 prompt/directive entries and 648 choices. Prompts are not assets. Imjin
has 196 recognized background prompt markers; its general prompt total is not
claimed. Explicit scene boundaries are absent in 62 parts (1-47 and 60-74), so
the 80 observed markers are not a complete playable graph. Part 75 lines 803-817
describe a single final main part with conditional epilogues. C is one stated
eligibility/tendency condition, not a demonstrated unique ending route. These
conditions and provenance are preserved as `ending_resolution_unmapped`; authored
part traversal is distinct from final ending eligibility. No confirmed conflict
with product A traversal, author rewrite, or user decision is asserted for offline
preservation. Runtime ending binding remains engineering work.

All 216 Norse CSV `sources` fields contain `System.Object[]` while JSON retains
the source arrays. `indexFieldObservations` records that specific pre-existing
degradation with logical CSV record numbers and JSON pointers; original CSV and
manifest are not changed. `sourceIndexQuality: observed_mismatch` is separate from
matched structural counts. This targeted check is not full-field CSV approval.

Both conversion/integrity/coverage gates are ready. Neither is upload-tested or
publish-ready. Remaining engineering work: intake-to-work/analysis bridge, safe
full-length request/staging and transaction handling, AI-required route execution,
ending interpretation, scene/reset bindings and real visual assets. Remaining
operational gates: rights/release approval, Norse price, then an authorized private
intake session. These do not block this completed offline preparation step.

Analysis payload SHA-256:

- Imjin: `d6153f69ffa9689c9c1453854f3401d49612d46f7e8614ad26c893ce30ec2995`
- Norse: `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8`

The original 26 synthetic tests cover determinism, readonly inputs, exact paragraph spans,
adjacent choices, source dialects, image count mismatches, UTF-8/BOM/CRLF/non-BMP,
duplicate/incomplete/reordered/truncated data, traversal, versions/hashes, CSV
quotes/newlines, approval isolation, immutable output and complete >150-part
preservation. Five additional tests cover reparse checks without `is_junction`,
lossless/unmapped preambles, empty labels, ending-label accuracy and CSV source
array placeholders. All 31 author tests and the unchanged eight QR1 adverse tests
pass after revision 2. The earlier frozen candidate failed three of those eight;
these results are author-run regressions, not a new independent QA approval.
Actual revision-2 prefixes preserve 112 Imjin / 179 Norse bytes with zero unmapped
prefix blocks; all 291 analysis parts retain the payload hashes listed above.
Independent QA and integration are still required; no whole-ticket
completion, runtime modification, main push or deployment is claimed.
