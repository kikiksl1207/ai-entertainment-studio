# QA2-001 - Live Product Smoke QA

Owner: Team2 QA
Status: open
Priority: P0

## Goal

Use the deployed product like a real user/operator and report blockers with
exact repro steps. Do not write code unless Leader explicitly reassigns.

## Areas To Check

- Login/logout and current user identity.
- Creator Studio access for an authorized creator.
- Backstage login and user management tab.
- Wallet adjustment confirmation modal only, if visible. Do not execute real
  production balance changes unless the user/Leader explicitly approves.
- Image upload path and object storage diagnostics.
- Artist detail follow/unfollow button copy, including the known
  `팔로잉해제` mojibake/copy issue.
- Feed author/profile click behavior and mini profile modal.

## Report Format

Write to `docs/ops/inbox/team2-qa.md`:

```text
status:
task:
environment:
tested_flows:
blockers:
repro_steps:
screenshots_or_notes:
suspected_owner: frontend | backend | unclear
next_needed:
```

## Do Not

- Do not change code.
- Do not modify production data except normal browsing/login.
- Do not reveal tokens, cookies, passwords, or secrets in the report.
- Do not test adult/Lumina Red flows.
