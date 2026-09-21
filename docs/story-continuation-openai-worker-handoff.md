# Story Continuation OpenAI Sidecar

This document records the frozen `ad41748` slice. The bounded #1896 follow-up in [story-continuation-dispatch-tokenizer-handoff.md](story-continuation-dispatch-tokenizer-handoff.md) supersedes its byte-budget and unfenced crash-replay limitations and adds the required pinned tokenizer dependency/migration. Other activation boundaries remain unchanged.

Status: opt-in implementation, not activated. No API key, generation request, deployment, payment change, dependency install or Prisma generation was performed. All adapter tests use fake transport. Existing production module remains unchanged.

## Integration Contract

Import from `server/src/story-production/story-continuation-runtime.providers.ts`:

```ts
import {
  STORY_CONTINUATION_OPENAI_PROVIDER,
  STORY_CONTINUATION_WORKER_PROVIDER,
} from './story-continuation-runtime.providers';
```

In the PM-owned module, replace the existing disabled `StoryContinuationProvider` binding with `STORY_CONTINUATION_OPENAI_PROVIDER`; add `STORY_CONTINUATION_WORKER_PROVIDER`. Do not register two bindings for the same token. `ConfigService` must be visible through ConfigModule/global config. Retain the existing executor, context assembler, moderation, economics and queue dependencies.

The provider factory injects `[ConfigService]`. The worker factory injects `[StoryContinuationExecutor, StoryContinuationProvider, ConfigService]`. Optional module exports are `StoryContinuationProvider` and `StoryContinuationWorker` (the latter imported from `./story-continuation.worker`). No new package dependency is required.

PM must call `app.enableShutdownHooks()` in bootstrap. Worker stops/aborts/drains in `OnModuleDestroy`. **Include the PrismaService hook change in this commit**: disconnect now occurs in `OnApplicationShutdown`, after all workers finish destruction. Providers in a module are destroyed concurrently, so provider ordering is not a substitute. There is no runtime monkeypatch. `beforeApplicationShutdown` is an idempotent fallback. Local scripts that directly invoked Prisma's old `onModuleDestroy()` should call `onApplicationShutdown()` or `$disconnect()` instead; repository search found no existing callers. PM's ephemeral smoke commands may need adjustment.

The worker is serial per instance/process, never fire-and-forget per job. Multiple deployed instances or manual admin ticks are not a global concurrency limit; retain queue leases and deploy only the intended worker count. Constructor/import never starts a timer. Explicit worker enablement plus provider readiness is required before claiming. Health is available through `worker.readiness()` with enabled/ready/active/stopping and sanitized reason, without prompt/error payloads.

## Pins And Preflight

Request names are exactly `provider`, `model`, `rateCardId`, `rateCardVersion` (optional strings for old tests; all four mandatory for this adapter). There are no aliases and no fallback to current config. PM maps these from the original reserved request's ledger/card with owner/work/release/card checks. Every request pin must equal configured values; the response's model must match too. Use a dated model snapshot, never a rolling alias. This is a structural snapshot check, not a claim of model access/support verified online. Prompt/schema versions remain `story-continuation-v1` / `story-continuation-output-v1`.

The base provider exposes optional `preflight(request): Promise<StoryContinuationProviderPreflight>`, default unsupported. Disabled provider is unsupported. Old plain-object doubles without this method remain callable via optional chaining. The adapter implements it locally without network, exposing only `supported`, `reason`, `budgetMethod`, `inputTokenUpperBound`, `inputTokenLimit`.

**PM integration required before activation:** after reusable-cache miss and before allowance reservation, assemble an equivalently approved/pinned context and call `provider.preflight?.(request)`. Fail closed if unavailable/unsupported for the real adapter. Do not pass secret configuration to economics or trust user-provided approvedContext. The same validation repeats at execution, so preflight does not replace authorization/lease/context rechecks. This sidecar does not implement economics pre-reservation wiring.

Input budgeting deliberately remains conservative: serialized request UTF-8 bytes (including instructions, projected context and JSON schema) plus 1,024 framing reserve must fit the pinned input-token cap. This is **not an exact tokenizer or a verified full-length Korean runtime**. A synthetic Korean 10,000-character scene split across ten beats is tested to reject at 8,192, while fitting the larger 32,768 test cap. No data is silently truncated and no budget is automatically enlarged. Next stage: supported-model-pinned local tokenizer, representative approved Korean context QA and reservation preflight integration. Official token-counting docs also warn that schema/framing are not plain-text tokenization; no remote token-count endpoint is used here.

## Activation Configuration

Both flags are OFF unless their exact trimmed/provider or worker config value is `true`; do not set these in this task. Supply through the deployment's secret/config mechanism, never commit a key.

| Name | Required / Default |
| --- | --- |
| `STORY_CONTINUATION_PROVIDER_ENABLED` | `true` explicitly; default OFF |
| `STORY_CONTINUATION_WORKER_ENABLED` | `true` explicitly; default OFF |
| `STORY_CONTINUATION_PROVIDER` | `openai` |
| `STORY_CONTINUATION_OPENAI_MODEL` | Approved dated snapshot, same as pinned card |
| `STORY_CONTINUATION_RATE_CARD_ID` | Exact pinned card ID |
| `STORY_CONTINUATION_RATE_CARD_VERSION` | Exact pinned card version |
| `STORY_CONTINUATION_OPENAI_API_KEY` | Dedicated secret, no general/chat-key fallback |
| `STORY_CONTINUATION_VISUAL_ASSET_PATH` | Existing approved neutral placeholder under `/assets/`, `.webp/.png/.jpg/.jpeg` |
| `STORY_CONTINUATION_REQUEST_TIMEOUT_MS` | 25,000; allowed 100..29,000, below executor's 30,000 timeout |
| `STORY_CONTINUATION_MAX_INPUT_TOKENS` | 32,768; allowed 1..128,000; never overrides a request cap |
| `STORY_CONTINUATION_MAX_OUTPUT_TOKENS` | 8,192; allowed 16..32,768; never overrides a request cap |
| `STORY_CONTINUATION_MAX_RESPONSE_BYTES` | 200,000; allowed 1,024..1,000,000 |
| `STORY_CONTINUATION_WORKER_POLL_MS` | 1,000; allowed 100..60,000 |
| `STORY_CONTINUATION_WORKER_MAX_BACKOFF_MS` | 30,000; poll interval..300,000 |
| `STORY_CONTINUATION_WORKER_DRAIN_MS` | 35,000; allowed 100..120,000 |

Use a drain window longer than request timeout plus DB settlement latency, and a deployment termination grace longer still. Invalid configuration is not coerced to a working value. Readiness is local/config-only; it does not validate key access, model availability or asset existence by network.

## Privacy, Output And Visual Boundary

Only explicit approved-context fields cross the API boundary: source-scene title/beats, selected-choice label, bounded semantic path, approved memory type/content. Request IDs, card pins, context fingerprints, full manuscript objects, arbitrary ORM fields and extra private fields are not serialized. Context strings are treated as untrusted story facts, not instructions. The approved assembler remains the trust boundary for the strings themselves; this adapter cannot discover hidden secrets inside an already-approved text.

Prompt preserves approved author/style memory and continuity, asks for materially consequential choices, and prohibits forced canonical convergence. This is instruction-level behavior, not a claim of evaluated narrative quality. No actual model generation was tested.

Responses uses `text.format` JSON schema with `strict: true`, `store: false`, `stream: false`, `background: false`, `truncation: disabled`, pinned `max_output_tokens`. No tools, images, remote URLs, conversation history, previous response ID or alternate model. `store: false` is not a claim of zero retention; account data policy remains a separate activation concern.

Strict locale slots: ko/en/ja/zh-Hans/zh-Hant only. No language-slot fallback, at most three distinct choices or one nonempty `ai-` ending. Existing output validator still validates all localized text, byte/token limits and visual whitelist. Empty/wrong-type ending keys now fail there even for non-OpenAI providers. Refusal, incomplete status, wrong model, invalid usage, malformed or oversized output fail closed without mock content.

**Visual is only an explicit neutral placeholder, not scene-specific illustration.** The model schema has no visual URL/manifest fields. Server constructs `state: fallback`, no characters and the configured existing public asset, then runs the existing visual sanitizer. It never invents/downloads/generates an image. PM must approve the placeholder and separately integrate approved scene-specific context manifests before claiming scene-specific visuals. Automatic visual generation remains disabled.

## Cost, Retry And Shutdown Boundaries

- Successful usage uses total `input_tokens`, the cached-input subset, and total `output_tokens` including reasoning. Reasoning is validated as a subset and never added twice. Image units are zero. Missing/noninteger/negative/out-of-bound/inconsistent usage is rejected, not silently zero-filled.
- Preflight/pre-dispatch abort sends nothing. Adapter reports `provider_cancelled` (safe to retry under the executor's bounded attempt policy).
- Once transport is dispatched, timeout, network errors, cancellation, HTTP 408 and HTTP 5xx are `provider_outcome_unknown`, nonretryable. Executor timeout/parent shutdown and transient settlement errors after generation also avoid automatic regeneration.
- Only an explicit HTTP 429 is retryable in this adapter, via the existing queue attempt cap/backoff. HTTP 409 and other 4xx are permanent. There are no in-adapter retries or alternate-model fallbacks. Retry classification does not guarantee provider billing behavior; maintain deployment spend limits and reconciliation.
- `operationId` is local identity, **not upstream idempotency**. It is not sent as a guarantee that duplicate Responses generation is free or deduplicated.
- Unobserved usage is not zero cost. PM confirmed failure settlement retains null `actualCostKrw`; its zero token counters are unobserved, not measured zero. Known measured usage rejected by moderation/output is not captured in this sidecar and needs future reconciliation. Do not present these failures as free generation.
- Worker cancellation waits for executor failure persistence before DB disconnect. If DB persistence itself fails, process is killed, or drain times out, existing lease recovery can still encounter an ambiguous in-flight request. Exactly-once upstream dispatch across crashes is **not solved** here: no attempt-ledger schema was added. PM must prevent unsafe replay/reconcile ambiguous leases before paid rollout.
- A drain timeout rejects shutdown instead of pretending the work completed; operational termination/DB failure handling remains PM responsibility. No raw request, key, context, refusal, HTTP error body, response payload or transport error message is logged or included in health/errors.

## Verification And Remaining Work

Focused Jest suites: adapter, worker, output-policy, executor-cancellation, existing executor, and Nest lifecycle. Run directly one at a time using `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath ...`; **do not use npm test** (its pretest generates Prisma). Caches/temp live on E. Shared node_modules is the PM-provided Kaido junction; no changes to the generated client.

Latest focused results for this candidate: adapter 68/68, worker 10/10, output-policy 14/14, executor-cancellation 4/4, existing executor 18/18, Nest lifecycle 3/3 (117 passing tests across six independently run suites). No full tsc/build or integrated PostgreSQL suite was run; PM owns those checks.

Nest lifecycle regression uses real `app.init()/app.close()` and real PrismaService prototype hooks with fake `$connect/$disconnect`. DB-first, worker-first and same-module layouts must all show dispatch -> abort -> failure persistence -> disconnect. Independent PM QA is still required for the shared Prisma hook change, whole-app shutdown, lifecycle smoke scripts and final integrated module.

Still disabled/unverified: module activation, flags/keys, real API, paid generation, deploy, tokenizer-supported full-length Korean context, economics preflight wiring, real PostgreSQL/crash recovery, measured-failure usage reconciliation, scene-specific approved assets, approved legal activation and model access. PM owns integrated tests, board, repository mapping and rollout.

## Official Sources

Searched and fetched before API implementation on 2026-09-22:

- Responses create reference: https://developers.openai.com/api/reference/cli/resources/responses/methods/create
- Structured outputs, strict schema and refusal handling: https://developers.openai.com/api/docs/guides/structured-outputs
- Token counting and local schema/framing limitations: https://developers.openai.com/api/docs/guides/token-counting
