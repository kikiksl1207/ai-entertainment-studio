# Story author-style automation status (2026-09-26)

## Implemented and deployed

- A successful creator manuscript submission now starts the semantic analysis request once with a retained idempotency key. Restored receipts do not auto-start, and stale account, work, or locale context cannot start it.
- Completing a new semantic analysis creates a `needs_review` generation-profile draft in the same transaction. Verified Lumina company works then auto-approve; outside authors still review and approve their draft. The approved profile is pinned to later AI continuation requests.
- Generated continuation output now requires exactly three distinct choices or an ending. A mixed ending/choice result is rejected instead of silently changing its route.
- Approving a reviewed semantic profile now indexes its cited, creator-approved canon, timeline, and foreshadow observations as bounded continuity memories. Older approved semantic memories for the same analysis are superseded in the approval transaction; unreviewed and foreign-analysis evidence cannot enter the generation context.
- A published work retains its previous completed non-semantic analysis while the new semantic profile is awaiting review. Approval switches subsequent continuations to the semantic analysis; works without a prior published analysis still fail closed.
- The semantic provider can reuse the server's existing `OPENAI_API_KEY`; an explicitly configured semantic key takes precedence.
- A pilot-only manuscript ID allowlist prevents other uploads from entering the paid queue while the first book is analyzed. It does not bypass ownership or idempotency checks.
- Creator Studio can restore the latest completed semantic analysis for an owned work even when the manuscript was published before the current browser session. The restore path uses owned read-only discovery and never enqueues another paid analysis.
- Focused frontend and backend tests pass. The semantic provider, worker, review draft, approval-to-memory path and three-choice validation are deployed on the production API (commit `94b6349`).

## Production audit before the pilot

- Five published stories have active AI consent and eight approved author-source style excerpts each.
- Their pre-pilot analyses used `publication_style_snapshot_v1`. The four other published works have not been semantically backfilled or approved.
- The pilot-only provider and worker configuration is active in production, reusing the existing `OPENAI_API_KEY`. The manuscript allowlist contains only the pilot version.
- The existing published reader route was not changed by starting the analysis.

## Agreed pilot

- First work: `내 이름을 먹지 않은 괴물`; user-approved analysis ceiling: KRW 10,000 for that one work.
- The final reader manuscript has 32 part files, 205,934 UTF-16 characters and 481,760 UTF-8 bytes. An offline o200k count of the manuscript text alone is 122,146 tokens; chunk framing, repeated instructions and output reservations make the actual job estimate higher.
- The production job planned 70 chunks and reserved KRW 8,199.793195 worst-case, under the approved KRW 10,000 ceiling, with an 8,192/16,000 per-chunk limit.
- The pilot manuscript version ID is `7a1035e1-3afe-4812-a57c-e0e1a20c66f7`. Keep `STORY_SEMANTIC_ANALYSIS_MANUSCRIPT_ID_ALLOWLIST` set to this ID until the pilot is reviewed and costs/quality are accepted.
- Live first- and last-chunk probes reached the pinned model and passed citation validation after the adapter changes. The adapter realigns only a unique exact quote within the cited source piece while requiring the reported offsets to remain within that piece (with a 16-unit boundary margin); ambiguous, nonexistent and out-of-paragraph citations still fail.
- A later-part probe showed non-style scene/event items with an irrelevant dialogue style category. That field is now cleared on non-style evidence. One malformed candidate no longer discards an otherwise valid chunk: valid cited candidates are retained and the rejected count is exposed to the writer in the analysis screen. If a nonempty model result has no valid candidate at all, the chunk still fails closed.
- The one authorized full-book job `c955581a-7f7c-411d-aed2-2ef1be33671f` completed in production: 70/70 chunks and 8,163/8,163 paragraphs, no job error. Actual observed cost was KRW 1,666.085625; five invalid candidates were discarded. A `needs_review` generation-profile draft `de7660fb-dc18-4232-81fb-1b784b812945` was created with eight review sections. The job retained 111 entity, 145 event, 79 foreshadow, 41 payoff, 153 scene, 130 style and 70 background semantic evidence items, plus 8,163 structural beats. These counts verify storage and coverage, not literary quality.
- Production confirmed that the pilot profile is now approved by the company auto-approval path, with a corresponding system audit event. The other four published Lumina works still have no completed semantic extraction; this change does not launch paid backfills.
- QA found that the approved pilot profile occupies 124,814 UTF-8 bytes and contains 20 observations in each of eight sections. Sending it whole would exceed or approach the 32,768-token continuation input ceiling, especially with 10,046-31,978 bytes of source scene prose. The continuation prompt now uses a deterministic, versioned, <=16,384-byte view while retaining the full approved profile and fingerprint in storage. A synthetic long-Korean-scene preflight passes without calling the model; production prose quality remains unverified until a reader-route trial.

## Remaining release gates

For works credited to `루미나` that also have matching official company publication provenance (a published import job or admin publication audit) and the same owner account, the owner has authorized automatic acceptance of the semantic generation-profile draft. On API startup, pending company drafts are reconciled; newly completed analyses attempt approval immediately. Approval remains pinned to the latest manuscript/analysis, writes the normal approved memories and a distinct system audit event, and does not change public release, AI-rights consent, or external-author review. A failed attempt leaves the draft recoverable. Drafts already edited by a person are not overwritten. The first pilot's production approval is confirmed; reader-quality still requires a selected-continuation trial.

1. Complete an actual selected continuation on the now-approved pilot profile. Verify source-version pinning, retry behavior, length, perspective, syntax, and route consequences on desktop and mobile. Auto-approval and synthetic input preflight do not establish literary quality.
2. Replace the requirement that a writer types the original route label for every part with AI proposals in the final review, while preserving writer edit/approval. The finalization screen currently asks for one manually entered label per part.
3. Evaluate generated prose from differently styled manuscripts, including the revised third and fourth works. Compare voice, POV, dialogue rhythm, chronology, foreshadow tracking, and narrative length; adjust analysis and generation prompts based on actual samples rather than claiming exact author imitation from unit tests.
4. Backfill existing published works only after the new route is verified. Do not create unapproved drafts in bulk; the pilot-only allowlist and cost ceiling stay in place until prose QA and operational memory behavior are accepted.

The legacy memory-builder endpoint still rejects semantic candidates. The new path is profile approval, which promotes only reviewed cited observations. It is intentionally bounded to 18 memories per profile; whole-book, scene-relevant retrieval still needs a production quality trial.

## Estimate

The first full-length semantic analysis is complete. The remaining author-style demonstration depends on creator review and a real continuation QA run, not another full-book extraction. Multi-work prose QA and safe migration remain separate release gates; the completed analysis alone does not prove faithful author-style generation.
