# Story author-style automation status (2026-09-26)

## Implemented locally

- A successful creator manuscript submission now starts the semantic analysis request once with a retained idempotency key. Restored receipts do not auto-start, and stale account, work, or locale context cannot start it.
- Completing a new semantic analysis now creates a `needs_review` generation-profile draft in the same transaction. The writer must still review and approve it. The approved profile is pinned to later AI continuation requests.
- Generated continuation output now requires exactly three distinct choices or an ending. A mixed ending/choice result is rejected instead of silently changing its route.
- Focused frontend and backend tests pass. These changes are local commits, not production deployment.

## Production audit

- Five published stories have active AI consent and eight approved author-source style excerpts each.
- Their only completed analyses use `publication_style_snapshot_v1`. None has a completed `semantic_extraction_v1` analysis or an approved generation profile.
- The production semantic-analysis provider and worker are not configured. Uploading a new manuscript after deploying only the UI change would return `SEMANTIC_ANALYSIS_UNAVAILABLE`.
- No paid semantic-analysis job was started during this audit. Existing published stories were not changed.

## Remaining release gates

1. Configure and verify a dedicated semantic provider, matching active rate card, worker, and operational safety budget. Pilot on one manuscript before processing long books; the API instance has previously hit its memory limit.
2. Complete a real upload -> full analysis -> profile review/approval -> three prepared choices -> selected continuation run. Verify source-version pinning, retry behavior, length, perspective, syntax, and route consequences on desktop and mobile.
3. Add a reviewed semantic-evidence-to-memory path. The current memory builder explicitly rejects semantic candidates, so the approved profile carries style/canon observations but does not automatically populate approved continuity memories from that analysis.
4. Replace the requirement that a writer types the original route label for every part with AI proposals in the final review, while preserving writer edit/approval. The finalization screen currently asks for one manually entered label per part.
5. Evaluate generated prose from differently styled manuscripts, including the revised third and fourth works. Compare voice, POV, dialogue rhythm, chronology, foreshadow tracking, and narrative length; adjust analysis and generation prompts based on actual samples rather than claiming exact author imitation from unit tests.
6. Backfill existing published works only after the new route is verified. Do not create unapproved drafts in bulk: a pending draft currently blocks that work's AI continuation until the owner approves it.

## Estimate

After production model and rate-card configuration, one complete author-style demonstration is roughly 3-5 working days. A reader-facing beta with multi-work prose QA and safe existing-work migration is roughly 1-2 weeks more. These are engineering estimates, not a guarantee; the first full-length analysis and generated continuation may expose provider, memory, or quality issues.
