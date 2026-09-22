# #1896 Author-Anchored Segment Length and Runtime Budget

Status: bounded INITIAL NEW-proof candidate, 2026-09-22; independent review
pending. Continuation enqueue/worker/settlement/length/timing integration is NOT
complete. Stage A passed 107 unit tests and whole type/schema checks. Stage B
applied migration66 only in fresh own QA, passed 97 tests and first/final whole
type checks after two recorded initial failures. Actual216 QA publication uses
synthetic owning-user confirmation, not real author approval. AppModule HTTP
coverage is health/bootstrap only. No paid call. See [Stage A](story-continuation-1896-stage-a-validation.md)
and [Stage B results and first failures](story-continuation-1896-stage-b-proof.md).

PM approved the common INITIAL NEW-submission proof, original-author profile,
timing coordinator and narrow economics validation. Follow
[the post-materialization final-review contract](story-continuation-1896-authored-review-contract.md)
for the authorized single-confirmation workflow and immutable 1:1 proof scope.

- Base: `d7627ca8e29cd9d78918929055b8e769d2a21bfe`, including `edebaee`.
- Branch: `codex/luffy-1896-length-budget-20260922`.
- Worktree: `E:/CodexMovedCache/worktrees/luffy-1896-length-budget-20260922`.
- Frozen #1853 candidate `770317c` and its physical dependencies remain untouched.
- Provider/worker paid activation remains OFF. This is not a quality or latency sign-off.

## Observed Architecture

| Boundary | Current code and gap |
| --- | --- |
| Source lineage | `story-production.service.ts:719` selects canonical `partId` or generated `sourcePartId`. `story-economics.service.ts:1917` copies that ancestor part into each generated scene. Generated descendants do not advance to the next authored part. |
| Provider context | `story-continuation-context.assembler.ts` supplies the immediate source scene, selected choice, up to 12 path steps, and approved memories. For generated descendants the scene text is AI text, not the original author's segment. Measuring that text repeatedly would permit a shrinking target. |
| Author identity | `StoryPart` has no manuscript-version/part-key FK. A release pins a manuscript and checksum, but that alone does not prove an arbitrary published part is a complete segment from that manuscript. `story-imjin-release-bridge.service.ts:145` materializes one scene per authored part; this is a bridge-specific property, not a general rule. |
| Input/output admission | `story-economics.service.ts:550` performs provider input preflight after a shared-result miss and before allowance reservation. It already prices the entire `capability.aiOutputTokenLimit`, but does not check whether that output allocation can accommodate an authored-length segment. |
| Effective output cap | Release capability DB default is **2,500** tokens (`schema.prisma:2128`). Adapter default ceiling is **8,192**, maximum **32,768**. The latter is not the actual allocation for every job. Raising an adapter ceiling alone does not fix admission. |
| Output validity | `story-continuation-openai.prompt.ts` asks for 1..40 beats, without a length target. `story-continuation-output.policy.ts` enforces locale keys, choices XOR ending, visual whitelist, 16,000 bytes per text, and 100,000 bytes total. A short nonempty paragraph can pass. |
| Incomplete responses | The adapter already rejects incomplete envelope/message status. This must remain. A `completed` response with valid JSON can still be a short summary or an unsatisfactory ending. |
| Reuse/settlement | The approved shared-result hit at `story-economics.service.ts:486` precedes provider preflight. `applyReusableResultTx` and direct/admin settlement are additional write boundaries. An adapter-only check cannot protect them. |
| Timing | Adapter default/max: 25/29 seconds; executor provider timeout: 30 seconds; lease: 60 seconds. Repository lease clamp: 300 seconds. Worker drain default/max: 35/120 seconds. Authorization, assembly, tokenization and settlement are outside the executor's provider timer. |
| Recovery | Dispatch is durably fenced before generation. Expired dispatched jobs become `provider_outcome_unknown`; explicit not-accepted 429 can clear the fence under the current lease. Recovery precedes provider readiness. Preserve all of these properties. |
| Inactive custom path | The queue claims `recommended_choice` only. The separate legacy custom-choice preparation path is not brought into service by this change; its release-policy denial and lack of this contract must remain explicit. |

The last 12 path steps, inherited source part, and book part counts (Imjin 75,
Norse 216) are not a whole-book timeline or a justified ending schedule.

## Smallest Trustworthy Anchor

Use one explicitly author-approved segment in the pinned release as a persistent
length reference. Do not select the previous generated output, infer a full part
from an arbitrary scene, match by title/position, or scan the whole manuscript in
an enqueue transaction.

Reference source: Kaido's source-key plan and materialization receipt, bound by
the existing writer's single final confirmation after UUID creation. The new
final-review proof commits to their hashes and the unchanged release checksum;
initial candidate creation does not require canonical UUIDs or already-approved
materialized text. See the concrete creation order and schema dependency in the
linked contract. Local bounded reads verify ownership, work/release/version,
source membership, locale, body hash and approval before deriving statistics.
A single scene is a full author segment only if that reviewed mapping says so.
The current Imjin marker/source hash alone is not a generic per-segment mapping.

The owner-only proposal measures verified private materialized narrative before
publication; otherwise the creation order would be circular. Generation later
requires the same approved reference to be published and unrevoked. Raw upload
metadata, private production directives, secrets and the full manuscript are not
added to provider context. Persist references/hashes/counts, not another text copy.

## Proposed Job Contract

Keep the existing `contextReferences` JSON column. Add a bounded, strict object
with unknown versions/fields rejected. The current source-only resolver type is
below; enqueue/worker persistence and enforcement are not yet wired:

```ts
type StoryContinuationSegmentPolicy = {
  version: 'author-segment-v1';
  proofId: string;
  proofHash: string;
  releaseId: string;
  manuscriptVersionId: string;
  sourcePartId: string;
  sourceSceneId: string;
  narrativeHash: string;
  sourceLocale: string;
  targetLocale: string;
  length: {
    profileVersion: 'author-length-80-120-v1';
    measurement: 'narrative-nonwhite-codepoints-v1';
    locale: string;
    referenceUnits: number;
    minUnits: number;
    targetUnits: number;
    maxUnits: number;
  };
  model: string;
  referenceTokens: number;
  minGeneratedSegments: number; // explicitly approved; no inferred book count
  generatedSegmentIndex: number;
};
```

Store `segmentPolicy` and `segmentPolicyHash` in job references, with the generated
index inside the hashed policy. Index 1 is the first segment from this anchor;
it is not a canonical part number or elapsed story time. Descendants copy the
original anchor and bounds through their owned generated scene's `continuationId`,
increment only the index and compute the resulting policy hash. Validate the
parent hash, user/work/progress/release/manuscript/source
part and parent result identity. Do not walk an unbounded ancestor chain.
An explicit authorized canonical rejoin may establish a new authored anchor;
never manufacture a rejoin to satisfy length or ending rules.

Measurement uses Unicode code points, not JS UTF-16 length or a universal
bytes/token ratio. Count only the verified narrative/dialogue (including canonical
`narration` mapped explicitly), excluding whitespace/control padding, title,
choices, visuals, and scene-break markers. Reject unsupported source beat kinds
instead of silently omitting them. No Unicode normalization or source mutation.
Combining sequences remain code points, not a claim of grapheme/word counts.

PM approved a proposed profile: target = original reference units, minimum = 80%
rounded up, maximum = 120% rounded down, with a versioned editorial profile. These
ratios are **not quality-validated facts or silently activated author approval**. They
scale with each author's segment instead of forcing 10,000 units. Custom ratio
editing is not implemented by this initial versioned profile.

Initial supported admission requires `sourceLocale === targetLocale`, one of
the existing five exact locales. A different target needs a separately approved
target-locale reference/translation; do not use Korean character/token density
as an English/Japanese/Chinese target or copy Korean into another locale field.
Locale-key validation does not prove linguistic quality.

## Output Admission Before Reservation

Extend the existing optional provider `preflight(request)` interface with safe
numeric diagnostics such as `requiredOutputTokens` and `outputBudgetMethod`.
It stays optional for old test doubles; the real v2 provider requires validated
segment pins. Disabled providers remain unsupported with no key/network work.

1. Resolve/validate authored policy before computing the context/reuse key.
2. A valid cache hit is checked against this policy without requiring a live
   provider, key or new paid allowance. A v1 cached result cannot bypass v2.
3. On cache miss, use the existing local model-pinned tokenizer. Pin an output
   sizing version/encoding, tokenized reference count, JSON/title/choice envelope
   allowance, conservative buffer, and explicit reasoning allocation. Unknown
   encodings or unsupported model settings fail closed.
4. Proposed sizing formula: scaled authored-reference tokens for `maxUnits`,
   plus a bounded serialized response-envelope allowance, conservative buffer,
   and reasoning headroom. All components are explicit and tested. Full input
   token measurement still includes instructions, schema and serialized context.
5. Require the resulting allocation to fit the release output allowance,
   configured/model output ceiling, model context window including framed input,
   and unchanged output shape/byte constraints. Do not shrink the target or
   truncate the anchor to make admission pass. Return a safe unsupported reason
   before allowance, continuation, progress or dispatch mutation.
6. Retain current worst-case cost reservation for the **entire** permitted output
   cap, including reasoning, plus bounded input at pinned provider/model/rates.
   Keep exact names `provider`, `model`, `rateCardId`, `rateCardVersion`.

Reference-token sizing is a conservative **estimate**, not a mathematical upper
bound on unknown prose or a guaranteed visible-token minimum. A reasoning
headroom reservation is not a separate API-enforced reasoning cap. Final output
must still pass validation; a model spending its allocation on reasoning cannot
be marked successful. Do not claim a 10k/20k segment is viable until later
offline representative sizing and separately approved paid quality/latency work.

The current byte/beat limits stay 100,000 total, 16,000 per text, and 40 beats;
choices stay at most 3 and the visual whitelist is unchanged. If the measured
profile cannot fit, report unsupported rather than silently raising these caps.

## Completion and Ending Rules

Prompt v2 carries the explicit measurement, target range and ending eligibility,
preserves approved author/style memory and material choice consequences, and
forbids substituting a summary or an ending for an exhausted budget. Context is
untrusted data, not instructions. Keep the existing result wire shape/schema v1
unless implementation demonstrates a real need for a new field; a model's
self-reported completion flag would not prove narrative resolution.

Run the same deterministic policy at executor output validation, successful
settlement (including direct/admin entry), and approved shared-result application.
Both ordinary segments and endings must satisfy the same narrative minimum.
API incomplete/refusal/malformed output, underlength, hard-cap violations and
an ending before its explicit approved eligibility point are terminal failures,
not a completed segment and not an automatic paid regeneration.

Once eligible, an AI branch may genuinely end differently from the canonical
story. There is no forced 75/216-turn endpoint or canonical convergence. Proposed
`minGeneratedSegments` can be 1 when the author explicitly allows immediate
resolution; its value cannot be guessed from source part position.

**Remaining quality boundary:** length, API completion and eligibility cannot
prove that a long ending resolves its plot, or that a long passage is not padded
summary. Do not claim automated semantic ending validation or whole-book pacing.
That requires an explicit future review/evaluation policy; adding a second paid
judge is not part of this slice.

Known received generation rejected by length/moderation may still have cost.
PM requires capturing validated received usage where possible in the later
runtime slice: parse numeric envelope usage before content rejection, retain
successful-result usage through executor failures, and settle those measured
counts/cost using pinned rates and existing ledger fields. Unobserved or invalid
usage/persistence failure retains unknown-cost representation (`actualCostKrw:
null`, not zero) and terminal fencing. Do not label unrecorded usage free.

## Fingerprints and Compatibility

- Add the segment-policy hash and branch index to context/execution and reusable
  content fingerprints; bump prompt version to `story-continuation-v2` everywhere
  that creates or validates a v2 job. Include model-specific sizing pins in the
  execution fingerprint; retain existing strict model/rate/budget checks.
- Shared content identity must not include reader ids or private job ancestry.
  Validate the originating approved result's profile and copy the applicable
  policy into the new reader's local continuation on reuse. Their descendants
  inherit locally; no arbitrary cross-reader parent lookup.
- Finished v1 scenes and settlement idempotent replays remain readable/unchanged.
  Do not backfill completed output as v2 or rewrite stored profile/chunks.
- Unfenced queued v1 jobs without a verified anchor are not silently upgraded
  from their previous AI text. Proposed behavior is known-no-dispatch terminal
  `author_segment_policy_required` with existing reservation-release handling.
  Explicit author/config repair and a fresh authorized request are separate.
- Dispatched legacy jobs retain unknown-outcome recovery **before** new profile
  or runtime readiness checks. Never make a missing v2 field a reason to resend.
- Unsupported/tampered profiles fail before dispatch. Direct/admin settlement
  cannot mark an unprofiled pending job a new v2 success to evade the worker.
- Optional preflight test doubles remain usable for unrelated tests; all new
  paid v2 success fixtures must contain genuine synthetic authored pins.
- Custom-choice, purchase, route, reader-memory and translation behavior are not
  activated or refactored. Reader response shape remains compatible.

## Coordinated Runtime Policy

Introduce one continuation-only versioned timing policy, constructed in the
existing runtime providers and consumed by adapter/executor/worker validation.
Store its small hash/pins in `contextReferences` and the execution fingerprint,
not the reusable content key. Runtime config changes must not silently change
the timing of a queued paid request; use its supported pins or fail before send.

Proposed bound: configurable provider request deadline up to 240 seconds,
executor watchdog at least 1 second longer, and a lease covering bounded
preparation + watchdog + settlement + clock margin, never above the existing
300-second repository limit. Exact margins need fixture verification; these are
admission bounds, not measured model throughput. Keep existing short defaults
unless an operator explicitly configures a supported longer profile.

Before marking dispatched, verify that the actual remaining lease covers the
watchdog plus settlement/clock margin; otherwise release safely without sending.
Bound DB preparation/persistence with real DB/transaction limits. Racing an
uncancellable database promise against a timer is not sufficient cancellation.
Do not introduce broad heartbeat or database-method monkeypatching.

Shutdown aborts promptly, then drains failure persistence/release while Prisma
is still connected. Validate `drainMs` against the bounded outstanding DB work,
abort grace and persistence margin, retaining the current 120-second ceiling;
it need not wait the whole provider deadline after an abort. If persistence is
unavailable, retain the durable fence for terminal recovery, never redispatch.
Repeat the actual Nest `app.close()` lifecycle test, not just hook unit tests.
The semantic worker's reuse of the generic serial worker must not inherit a
continuation-specific timing change accidentally.

## Authorized Edit Scope

1. New small `story-continuation-length.policy.ts` and runtime-policy helper,
   focused specs, and a bounded authored-reference resolver. No new dependency.
2. Narrow `story-continuation-context.assembler.ts`/context policy, provider
   request/preflight types, tokenizer reuse, OpenAI prompt/config/adapter,
   output policy, executor, runtime factories, and repository claim projection
   for remaining lease/pins where necessary. Preserve dispatch CAS semantics.
3. **PM-coordinated necessary economics hunks:** recommended enqueue before
   reservation, fingerprints, shared-hit application/inheritance, and successful
   settlement validation. Adapter-only implementation would be incomplete.
4. **Approved common proof contract:** verified receipt-backed whole-part mapping
   and the single existing final-confirmation transaction, INITIAL NEW submissions
   only. No upgrade of old submissions, reopening terminal reviews, supersession,
   implicit edits to the Imjin bridge or rewriting an immutable release. The
   additive 1:1 proof/revocation migration provides immutable DB binding.
5. Docs and focused tests. Continuation job pins need no new column; the common
   final-review proof/revocation requires its separately approved additive schema.
   No purchase/route/reader-memory changes, broad module refactor, new translations,
   model switch, or paid calls.

## Proposed Validation

Stage A covered pure helper and service/boundary units plus whole-server typing.
The broader matrix below remains required; PG/full runtime checks are unexecuted
and require a separately granted slot. QR1's approved-content mutation P2 remains
an acceptance blocker, as documented in the common proof contract.

| Layer | Required cases |
| --- | --- |
| Measurement | Synthetic authored 10k and 20k references remain different targets; surrogate pairs, combining text, whitespace/control padding, narration/dialogue vs scene breaks, unknown kinds, exact five-locale handling. |
| Trust | Wrong owner/work/release/version/locale/content hash, incomplete or ambiguous segment mapping, stale approval and oversized reference all reject before reservation/send; raw/private fields never enter prompt or errors. |
| Legacy Imjin | Accepted older `b51` import/read/publication is not v2 anchor evidence. Missing receipt/proof/sourceSceneKey cannot be invented or upgraded; preserve canonical reading and legacy publication checks, deny v2 generation. Synthetic boundary specs passed Stage A, not actual Imjin QA or full enqueue coverage. Verified generic import/mapping preparation is a follow-up. |
| Lineage | Three generated descendants of differing/shorter lengths retain the original anchor and target. Explicit canonical rejoin uses the new approved anchor. Foreign progress/parent and hash tampering fail. |
| Admission | Input schema/instructions overhead; all output envelope/buffer/reasoning components; effective 2,500/8,192 caps; unknown model encoding; context window; unaffordable 20k profile; no allowance/progress/job/send writes on failure. |
| Output | Valid JSON short summary fails; exact floor passes; title/choice/scene-break padding does not count; ending does not bypass floor; below-eligibility ending fails; eligible distinct AI ending can pass; incomplete envelope/message fails. |
| Shared/direct writes | v1 cache cannot bypass v2; profile/hash/index mismatch misses or rejects; approved v2 reuse needs no provider/key; local clone inherits correct pins; direct/admin settlement enforces the same policy; old terminal replay unchanged. |
| Queue/unknown cost | Missing legacy profile known-zero-send path; post-dispatch timeout/cancel/process death and failure-persistence failure become unknown, no resend; lease-CAS explicit 429 backoff remains; length rejection never auto-regenerates. |
| Timing/lifecycle | Fake timer deadlines; invalid combinations; slow preparation/insufficient lease before fence; PG cross-worker lease expiry after fence; real Nest abort/drain/persist before DB disconnect; semantic worker unaffected. |
| Startup | Full AppModule with continuation/semantic defaults OFF and no provider key/rate env: health 200, no network, clean close. |
| Later offline sizing | Read-only approved per-part narrative metrics for actual Imjin/Norse with counts/hashes only; no raw console/Git/provider data. No assertion that all Norse release references currently exist. |

## Approved Decisions and Remaining Integration

1. The post-materialization receipt/whole-part binding and immutable common proof
   are approved for INITIAL NEW submissions only. Existing manuscript-only rows
   stay historical and cannot authorize v2; edition/supersession is a future gap.
   Use the actual receipt fields, not an invented planId or persisted mapping.
   See the [common proof contract](story-continuation-1896-authored-review-contract.md)
   for the single-confirmation transaction, revocation and legacy Imjin boundary.
2. Author confirmation is still required for the PM-approved proposed 80..120%
   profile and ending eligibility (which may explicitly allow segment 1).
3. Narrow economics shared-hit/settlement validation is approved. It remains
   unwired until the trusted anchor chain and usage accounting are implemented.

## Official API References

Read the OpenAI documentation skill; searched official docs, then fetched the
following pages on 2026-09-22. Documentation requests did not use an API key or
send manuscript context.

- `max_output_tokens` includes visible output and reasoning, so it is not a
  visible-prose allowance alone: [Responses create reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
- Exhausting the allocation may yield incomplete output with input/reasoning
  cost even without usable visible text: [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).
- Schema conformance does not establish semantic correctness; refusal and
  incomplete responses require separate handling: [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

No model/pricing recommendation, live output, paid latency measurement or
production-readiness claim is made by this proposal.
