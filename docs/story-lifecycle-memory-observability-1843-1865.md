# Story Lifecycle, Memory, and Observability #1843, #1844, #1846, #1852, #1862, #1865

This delivery connects the production release architecture to persisted server APIs.

- Public catalog and detail reads require a published work and an active immutable release.
- Candidate releases contain manuscript, graph, ending, scene asset, and localized display snapshots under one checksum. Activation or rollback atomically switches the work pointer; active reader progress pins that release.
- Reader state provides explicit save-slot overwrite/clear confirmation, at least three slots, release-pinned checkpoints, and an ending gallery with path signature and provenance. Entitlements remain independent.
- Analysis evidence is indexed into bounded, provenance-bearing memory records. Retrieval returns at most 50 current-part or related memory records and never resends the full manuscript.
- Writer completion review persists ordered states, optimistic revision, decisions, continuity gates, modal reentry state, and one idempotent final submission.
- Quality events are written by server story operations with hashed session keys and allowlisted aggregate dimensions. They contain no manuscript text, private choice content, provider payload, or user identifier. Aggregates are emitted only from measured events.

Apply migration `0050_story_release_memory_observability` after the story production and progress migrations. Actual publish, rollback, and final submission staging checks require an approved test work and operator identity supplied through the private QA channel.

Run `npm run qa:story-lifecycle-release` for the source and migration contract. Run `STORY_LIFECYCLE_STAGING_MODE=preflight npm run qa:story-lifecycle-staging-readonly` before the private read-only staging check. The staging verifier reads lifecycle, save-slot, and ending-gallery projections only; it emits a run ID, public paths, status, boolean checks, and `mutationExecuted: false` without exposing the session or approved work identifier.
