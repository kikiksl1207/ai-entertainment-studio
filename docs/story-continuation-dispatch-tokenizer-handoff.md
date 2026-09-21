# Story Continuation #1896 Follow-Up

This slice follows frozen `ad41748` and PM `a463659`, cherry-picked locally as `e5c8e50`. Default provider/worker flags remain OFF. There were no live provider requests, keys, network token-count requests, deployment or economics changes.

## Local Token Budget

- Exact dependency: `js-tiktoken@1.0.21` (pure-JS tiktoken port), pinned in package and lock. Its bundled encoding data is local; no CDN loading. Install used our own physical node_modules after removing only the verified donor junction, with E-drive cache/temp. Donor dependencies/client were not changed.
- Dated configured models must exist in this pinned library's exact model table and map to `o200k_base`. Unknown models, invented future snapshots, rolling aliases and unsupported encodings fail readiness/preflight closed (`provider_model_encoding_unknown` / `provider_model_not_pinned`). No prefix inference or fallback encoding.
- Count the entire serialized Responses body, including approved context, instructions, strict schema and request fields. Treat special-token-looking text as literal story data. Reserve **10% plus 256 tokens** above the local count for framing/schema representation differences. Refuse requests above 256,000 serialized UTF-8 bytes before tokenization. Nothing truncates or enlarges the pinned limit.
- Preflight's existing optional interface remains unchanged. `budgetMethod` is now `js_tiktoken_o200k_base_v1`; `inputTokenUpperBound` is this conservative local **budget estimate**, not a remotely verified exact model token count or mathematical upper-bound guarantee. Actual returned usage still must fit the pinned caps.
- The varied original Korean QA fixture has **10,000 source characters, 37 beats**, approved author/style and relationship memories, one semantic path, and a material selected choice. The complete serialized request plus reserve is **7,949 / 8,192 tokens** for the test's configured `gpt-4.1-2025-04-14`. Every source field survives projection unchanged; changing the selected choice changes the request; a 1,000-token cap is rejected rather than truncated. A separate repeated-prose 10k test also passes.
- This proves the previous universal UTF-8-byte rejection is removed for these representative synthetic fixtures. It does not mean every Korean 10k text fits 8k, nor that prose quality, novel continuation or a live model's exact token usage was evaluated. Dense/longer context can still require a higher explicitly approved reservation or a rejection. No full-feature rollout claim.

`StoryContinuationProvider.preflight?.(request)` is available without sharing secret config with economics. Executor repeats this local check before committing a dispatch fence. PM still owns economics cache-miss/pre-reservation wiring, including assembling the approved context before reserving allowance; no economics file was edited here.

## Durable Dispatch Fence

Migration: `20260922141000_story_continuation_dispatch_fence`.

Only `StoryAiContinuation.dispatchStartedAt DateTime?` (`dispatch_started_at TIMESTAMPTZ(6)`) is added to schema. Migration conservatively fences already-processing recommended jobs, since old workers may already have sent them. Stop old workers before migration/rollout; mixed old executors do not understand this fence. Schema generation/migrations were run only for this worktree and the dedicated provider QA DB.

State transitions:

1. Claim an unfenced job with the existing SKIP LOCKED queue. Validate authorization, approved context and local preflight. Cancellation before this point may release for retry without a fence or provider call.
2. `queue.markDispatched(claim)` commits a single autocommit CAS **before** `provider.generate`. It requires ID, processing status, exact lease token/attempt, an unexpired lease using DB clock, recommended request kind, and no existing fence. No HTTP call occurs inside a database transaction. Failure or lost acknowledgement prevents invocation and becomes `provider_outcome_unknown` conservatively.
3. The fence remains across process death, timeout, shutdown, refusal, malformed output, moderation rejection, settlement failure and failed failure-persistence. `claimNext` excludes every fenced row. An expired fenced processing lease is claimable only by `claimExpiredTerminal`, regardless of remaining attempt count.
4. Executor sees recovered `dispatchStartedAt`, persists `provider_outcome_unknown` failure and returns `recovered_outcome_unknown`, without provider readiness or generation. If persistence fails repeatedly, later terminal recovery can retry persistence, never generation. An unfenced expired lease can still be reclaimed normally.
5. Only an explicit received 429 from the adapter uses `releaseNotAcceptedForRetry`. One valid/unexpired-lease CAS clears the fence **and** releases to bounded retry_wait. Generic `releaseForRetry` requires a null fence and cannot clear it. Stale owners, expired leases and exhausted attempts cannot reset a fence. A crash after receiving 429 but before clearing it is conservatively unknown, not regenerated.

The `markDispatched` name means durable permission-to-dispatch, not proof that bytes reached OpenAI. A crash immediately after fencing but before sending sacrifices the attempt instead of risking duplicate billing. This is an at-most-once automatic-dispatch policy per accepted attempt, not an exactly-once upstream API guarantee. No operation/user IDs or context are added to provider metadata, headers or logs, and operationId remains local identity rather than upstream idempotency.

Actual cost stays unobserved/null through the existing failure-settlement policy; zero token placeholders must not be described as measured zero cost. Capturing known usage from rejected/moderated output remains a separate future change. Manual resubmission/admin resets are outside the automatic fence guarantee and must not clear ambiguous fences without reconciliation.

## Wiring And Rollout

Existing factory wiring and opt-in config from the prior handoff are unchanged. Include the prior Prisma shutdown hook change. New package dependency must be installed, own generated Prisma client refreshed, and the new migration applied before using this repository/executor. Do not activate against an unmigrated schema.

Queue interface now requires:

```ts
markDispatched(claim: StoryContinuationClaim): Promise<void>;
releaseNotAcceptedForRetry(claim: StoryContinuationClaim, retryAt: Date): Promise<void>;
```

Claims additionally expose `dispatchStartedAt?: Date | null`. These are internal queue fields, not new provider metadata. Existing PM reserved provider/model/rateCardId/rateCardVersion joins are preserved. Economics/preflight reservation integration is PM's next step after Kaido's ownership is released.

## Verification

- Fresh dedicated PostgreSQL QA DB: baseline 56 migrations plus dispatch migration, all 57 applied successfully. No activation/other QA database touched.
- Real PostgreSQL suite: **6/6**, two independent Prisma connections. Covers simultaneous claim and dispatch CAS, expired fenced recovery below max attempts, unfenced crash reclaim and stale-owner rejection, generic retry forbidden from clearing fence, explicit 429 atomic release, expired-owner rejection, and failed failure-persistence recovery with provider invocation count remaining exactly one.
- PG fixture setup/cleanup alone uses transaction-local replica mode to omit unrelated ownership fixtures. Actual repository/executor operations run with normal DB triggers/check constraints. This is not legal/economics integration QA. Test refuses a non-loopback or incorrectly named database and uses `STORY_PROVIDER_TEST_DATABASE_URL` only; do not print its value.
- Adapter: **68/68** fake-transport tests. Executor: **23/23**; cancellation: **4/4**; PM repository pin regression: **5/5**. Tokenizer/context: **11/11**. Total **117 tests** in six bounded suites for this follow-up. All run serially with `--runInBand`, no npm pretest generation.
- The local package model table, counts and projection are tested offline; no API billing or output-quality claim is implied. PM owns full integrated tsc/build, economics reservation hooks, activation rights, and independent review. Previous frozen slice's visual fallback-only boundary remains.

## References

Official OpenAI documentation searched and fetched before this implementation:

- https://developers.openai.com/api/docs/guides/token-counting
- https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken

The official guidance warns local estimates cannot exactly reproduce all model/schema framing. The pinned third-party library's bundled README documents offline encoding usage; it is not an OpenAI-endorsed billing oracle. Current token budgeting intentionally keeps explicit overhead and validates actual usage on success.
