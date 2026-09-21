# Story Continuation Integration Checkpoint

## Runtime Connection

The production module now registers opt-in provider and worker factories. Both
remain disabled without explicit configuration. Shutdown hooks drain the worker
before Prisma disconnects. Economics preflights the exact pinned provider/model/
rate-card request before reserving personal allowance, and budgets the complete
serialized provider payload rather than just one-quarter of context characters.
Approved exact shared hits bypass provider readiness/preflight and reserve no
new allowance. Preflight and queue execution use the same reserved UUID; caller
idempotency strings are not used as provider operation identifiers.

Focused factory/economics/reuse tests: 28 passed before the identity regression;
the updated economics selection subsequently passed 21 tests. The additional
tokenizer, actual-source policy and factory selections passed 24 tests. These
counts overlap and must not be summed as independent product coverage.

## Actual Imjin Input Check

The canonical import groups up to 7,500 UTF-16 units per public beat. The provider
previously rejected beats above 16,000 UTF-8 bytes, rejecting all 75 actual parts
before generation. The per-beat byte guard is now 32,000 while the full-request
256,000-byte guard and pinned total token limits remain unchanged. No source
content is removed, shortened or rewritten.

Offline command, with the approved external source path supplied by the operator:

```powershell
node -r ts-node/register/transpile-only scripts/verify-imjin-provider-preflight.ts SOURCE
```

- Actual source checksum: `34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125`.
- 75 parts; 150 B/C requests passed projection-preserving source-only preflight.
- Maximum actual source beat: 17,817 UTF-8 bytes; maximum three beats per part.
- Local input budget, including request schema/instructions and reserve: 6,521
  to 16,932 tokens at an explicit 32,768-token cap, using the pinned tokenizer
  mapping for `gpt-5-mini-2025-08-07`. This is not exact billed usage.
- No external provider call, network token count, database write or source output.
- Historical route, approved memory, semantic quality, desired output length and
  real latency still require separate integration/evaluation. An 8k cap is not
  enough for every actual part; do not silently clamp or truncate.

## Deployment Boundaries

The implementation is an integration candidate, not a live story release.
Independent activation review found the public choose precheck missing locale,
transaction and rights version, and descendant revocation blocked after parent
revocation. Corrective `2f6ccc3`, integrated as `d62fb7e`, resolved both findings.
Independent corrective PostgreSQL review passed 10/10 with normal ownership
constraints and triggers, including public controller entry and ancestor-lock
races. The original rejection evidence is preserved. This is bounded acceptance,
not a live release or an HTTP/JWT middleware test.

Provider follow-up `88a59fd` also received bounded independent acceptance:
11 tokenizer tests, four offline executor failures and five PostgreSQL dispatch
fence counterexamples. The PG queue operations used normal constraints; only
their synthetic ownership-incomplete setup/cleanup used transaction-local replica
mode. Provider/context/economics doubles were used in those fence tests, so they
do not establish real billing settlement. The activation tests separately used
normal constraints throughout and verified zero-cost approved-result reuse.

Fresh integration database: all 60 migrations at `d62fb7e` applied; own generated
Prisma client and full TypeScript noEmit passed. Purchase candidate `cdf4e9a`
subsequently integrated as `6fc7a99` after independent purchase PG review 8/8.
Its CHECK migration and the forthcoming route/UI candidates still require the
next combined integration run. Authored and independent counts overlap in scope
and must not be added to imply unique whole-product coverage.

The current 25-second provider timeout and prompt's one-to-forty-beat output
contract do not establish that a long chapter can be generated at the intended
length. Measure actual latency and output completeness before enabling long-form
generation; do not count short synthetic output as a finished 10k-character part.
Whole-route identity and reader-derived narrative memory are separate work.
Current manuscript analysis is still deterministic paragraph/tag extraction, not
semantic model analysis. The lifecycle memory builder's first-1,000-evidence cap
and background-to-style mapping must not be presented as complete long-form
author analysis. Asynchronous evidence extraction, explicit author review,
approved style profiles and spoiler-aware reader-derived memory remain required.

Model selection is not finalized by offline fixtures. Official documentation,
checked 2026-09-22, schedules this GPT-5 Mini snapshot's shutdown for 2026-12-11.
Do not treat a successful local tokenizer check as proof of live model access or
a permanent production choice. Revalidate available model, tokenizer mapping,
prompt/output behavior and rate card before activation. Sources:
[model documentation](https://developers.openai.com/api/docs/models/gpt-5-mini),
[deprecation schedule](https://developers.openai.com/api/docs/deprecations).

No API key is present in the checked local process environment or the canonical
server environment files. This says nothing about secrets configured on Render.
Use a protected server environment setting for credentials, never chat or Git.
