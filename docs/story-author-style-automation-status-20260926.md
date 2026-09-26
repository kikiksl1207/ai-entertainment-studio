# Story author-style automation status (2026-09-26)

## Implemented locally

- A successful creator manuscript submission now starts the semantic analysis request once with a retained idempotency key. Restored receipts do not auto-start, and stale account, work, or locale context cannot start it.
- Completing a new semantic analysis now creates a `needs_review` generation-profile draft in the same transaction. The writer must still review and approve it. The approved profile is pinned to later AI continuation requests.
- Generated continuation output now requires exactly three distinct choices or an ending. A mixed ending/choice result is rejected instead of silently changing its route.
- Approving a reviewed semantic profile now indexes its cited, creator-approved canon, timeline, and foreshadow observations as bounded continuity memories. Older approved semantic memories for the same analysis are superseded in the approval transaction; unreviewed and foreign-analysis evidence cannot enter the generation context.
- A published work retains its previous completed non-semantic analysis while the new semantic profile is awaiting review. Approval switches subsequent continuations to the semantic analysis; works without a prior published analysis still fail closed.
- The semantic provider can reuse the server's existing `OPENAI_API_KEY`; an explicitly configured semantic key takes precedence.
- A pilot-only manuscript ID allowlist prevents other uploads from entering the paid queue while the first book is analyzed. It does not bypass ownership or idempotency checks.
- Focused frontend and backend tests pass. These changes are local commits, not production deployment.

## Production audit

- Five published stories have active AI consent and eight approved author-source style excerpts each.
- Their only completed analyses use `publication_style_snapshot_v1`. None has a completed `semantic_extraction_v1` analysis or an approved generation profile.
- The production semantic-analysis provider and worker are not configured. Uploading a new manuscript after deploying only the UI change would return `SEMANTIC_ANALYSIS_UNAVAILABLE`.
- No paid semantic-analysis job was started during this audit. Existing published stories were not changed.

## Agreed pilot

- First work: `내 이름을 먹지 않은 괴물`; user-approved analysis ceiling: KRW 10,000 for that one work.
- The final reader manuscript has 32 part files, 205,934 UTF-16 characters and 481,760 UTF-8 bytes. An offline o200k count of the manuscript text alone is 122,146 tokens; chunk framing, repeated instructions and output reservations make the actual job estimate higher.
- A read-only plan against the published manuscript version and the active rate card produced 70 chunks, 564,851 reserved input tokens, 1,120,000 reserved output tokens and KRW 8,195.457445 worst-case reservation with an 8,192/16,000 per-chunk limit. The job output ceiling must be at least 1,120,000; a one-million ceiling would fail after reserving the manuscript version.
- The pilot manuscript version ID is `7a1035e1-3afe-4812-a57c-e0e1a20c66f7`. Keep `STORY_SEMANTIC_ANALYSIS_MANUSCRIPT_ID_ALLOWLIST` set to this ID until the pilot is reviewed and costs/quality are accepted.
- A live first-chunk probe reached the pinned model and returned grounded evidence, but its citation `end` offsets counted two extra units for many exact quotes. The full job was not enqueued. The adapter now realigns only a unique exact quote in the cited source paragraph when both reported offsets are within 16 UTF-16 units; ambiguous or forged citations still fail. Re-probe after deploying that validator change before enqueue.
- Do not enqueue until the production provider, matching active rate card, worker and worst-case aggregate reservation are verified. A budget-rejected reserved job cannot currently be retried on the same manuscript version.

## Remaining release gates

1. Configure and verify a dedicated semantic provider, matching active rate card, worker, and operational safety budget. Pilot on one manuscript before processing long books; the API instance has previously hit its memory limit.
2. Complete a real upload -> full analysis -> profile review/approval -> three prepared choices -> selected continuation run. Verify source-version pinning, retry behavior, length, perspective, syntax, and route consequences on desktop and mobile.
3. Replace the requirement that a writer types the original route label for every part with AI proposals in the final review, while preserving writer edit/approval. The finalization screen currently asks for one manually entered label per part.
4. Evaluate generated prose from differently styled manuscripts, including the revised third and fourth works. Compare voice, POV, dialogue rhythm, chronology, foreshadow tracking, and narrative length; adjust analysis and generation prompts based on actual samples rather than claiming exact author imitation from unit tests.
5. Backfill existing published works only after the new route is verified. Do not create unapproved drafts in bulk: a pending draft currently blocks that work's AI continuation until the owner approves it.

The legacy memory-builder endpoint still rejects semantic candidates. The new path is profile approval, which promotes only reviewed cited observations. It is intentionally bounded to 18 memories per profile; whole-book, scene-relevant retrieval still needs a production quality trial.

## Estimate

After production model and rate-card configuration, one complete author-style demonstration is roughly 3-5 working days. A reader-facing beta with multi-work prose QA and safe existing-work migration is roughly 1-2 weeks more. These are engineering estimates, not a guarantee; the first full-length analysis and generated continuation may expose provider, memory, or quality issues.
