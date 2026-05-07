# BB-002 - 1st Fan Engagement Loop UI Map

Owner: Builder B / Frontend
Status: open
Priority: P1

## Context

Chamo PM reviewed the 20 expansion items and cut the 1st product loop down to
low-effort fan participation:

- one-tap missions
- concept votes
- fan one-line proposals
- AI feed/comment draft reactions
- Creator Studio today tasks
- achievements / points / titles

Users are assumed to be lazy. Prefer click/tap actions over upload-heavy or
long-form creation workflows.

## UI Goal

Map the 1st loop to existing pages with minimal new UI. Do not build the whole
feature yet unless a tiny static skeleton is clearly useful.

## Pages To Map

- `index.html`: entry point for one-tap daily mission teaser.
- `character-detail.html`: artist-specific one-tap mission, concept vote, one-line proposal.
- `lumina-feed.html`: show approved fan proposals / artist reactions as feed content.
- `mypage.html`: achievements, points, titles, participation history.
- `user-profile.html`: public title/badge exposure.
- `creator-studio.html`: "today tasks" approval queue for fan proposals and AI reaction drafts.
- `backstage.html`: mission setup / fan engagement overview for admins.

## PM Constraints

- No dance/video upload in 1st pass.
- No public trading marketplace.
- No revenue-sharing UI.
- Rewards are first shown as achievements, points, titles, or exposure priority.
- AI-generated reactions must show approval state before publish.
- Avoid a landing-page style treatment. These are product controls inside existing surfaces.

## Deliverable

Write a concise UI map to `docs/ops/inbox/builder-b.md`:

- Which existing page gets which block.
- Minimum component copy in Korean.
- Empty/loading/error states.
- Which endpoint each block expects from Builder A.
- Any frontend risk or dependency.

If you make a code patch, keep it narrow and run:

- `node --check backstage.js`
- parse any changed inline scripts with Node Function constructor if editing HTML inline scripts.
- `git diff --check`
