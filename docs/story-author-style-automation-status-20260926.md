# Story author-style automation status (2026-09-26)

## Implemented locally

- A successful creator manuscript submission now starts the semantic analysis request once with a retained idempotency key. Restored receipts do not auto-start, and stale account, work, or locale context cannot start it.
- Completing a new semantic analysis now creates a `needs_review` generation-profile draft in the same transaction. The writer must still review and approve it. The approved profile is pinned to later AI continuation requests.
- Generated continuation output now requires exactly three distinct choices or an ending. A mixed ending/choice result is rejected instead of silently changing its route.
- Approving a reviewed semantic profile now indexes its cited, creator-approved canon, timeline, and foreshadow observations as bounded continuity memories. Older approved semantic memories for the same analysis are superseded in the approval transaction; unreviewed and foreign-analysis evidence cannot enter the generation context.
- Focused frontend and backend tests pass. These changes are local commits, not production deployment.

## Production audit

- Five published stories have active AI consent and eight approved author-source style excerpts each.
- Their only completed analyses use `publication_style_snapshot_v1`. None has a completed `semantic_extraction_v1` analysis or an approved generation profile.
- The production semantic-analysis provider and worker are not configured. Uploading a new manuscript after deploying only the UI change would return `SEMANTIC_ANALYSIS_UNAVAILABLE`.
- No paid semantic-analysis job was started during this audit. Existing published stories were not changed.

## Agreed pilot

- First work: `내 이름을 먹지 않은 괴물`; user-approved analysis ceiling: KRW 10,000 for that one work.
- The final reader manuscript has 32 part files, 205,934 UTF-16 characters and 481,760 UTF-8 bytes. An offline o200k count of the manuscript text alone is 122,146 tokens; chunk framing, repeated instructions and output reservations make the actual job estimate higher.
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
