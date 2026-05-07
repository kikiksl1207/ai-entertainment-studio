# FE2-001 - Existing UI Bugfixes

Owner: Team2 Frontend
Status: open
Priority: P1

## Goal

Fix small existing UI/copy bugs that block QA, without starting the new fan
engagement loop UI owned by Team1 BB-002.

## Allowed Scope

- Static frontend files such as `app.js`, `backstage.html`, `backstage.js`,
  `backstage.css`, `creator-studio.html`, `lumina-feed.html`,
  `character-detail.html`, `user-profile.html`, `mypage.html`.
- `docs/ops/inbox/team2-frontend.md`

## Focus

- Known follow/unfollow copy issue: `팔로잉해제` should be readable Korean copy,
  e.g. `팔로잉 해제`.
- Feed author/profile click mini-profile behavior if broken.
- Image upload UI broken states if QA provides repro.
- Backstage modal copy/layout issues if QA provides repro.
- Mobile layout regressions in the touched pages.
- Localization/copy regressions in the touched pages, especially mojibake or
  hardcoded English-only labels where the existing UI already supports Korean.

## Do Not

- Do not implement Team1 BB-002 fan engagement loop.
- Do not change backend contracts.
- Do not redesign whole pages.
- Do not touch secrets or `.env`.

## Output

Write to `docs/ops/inbox/team2-frontend.md`:

```text
status:
task:
branch/commit:
changed_files:
tests:
result:
blocked_by:
next_needed:
```

Required checks when code changes:

- `node --check backstage.js` if Backstage changed.
- Parse changed inline HTML scripts with Node Function constructor.
- `git diff --check`.
