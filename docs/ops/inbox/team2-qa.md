# Team2 QA Inbox

status: blocked
task: QA2-001 - Live Product Smoke QA
environment:
- local repo: C:\Users\하마다랩스\Documents\New project\workspace-core
- current branch: team2-qa/QA2-001-live-product-smoke-qa
- base sync: `git pull origin main` completed; already up to date
- allowed docs read: docs/ops/agents.md, docs/ops/board.md, docs/ops/tasks/open/QA2-001-live-product-smoke-qa.md
tested_flows:
- Not executed. The assigned docs did not include a deployed product URL, QA account, authorized creator account, Backstage operator account, or explicit test environment instructions.
blockers:
- P0: Cannot perform live product smoke QA without a deploy URL and non-secret test account/role guidance.
- P0: Cannot verify Creator Studio authorized access without knowing which test identity should have creator authorization.
- P0: Cannot verify Backstage login/user management without an operator-safe account or access path.
- P0: Cannot safely reach wallet adjustment confirmation, image upload/object storage diagnostics, artist follow/unfollow copy, or feed mini profile modal without the product URL and login path.
repro_steps:
1. Pull latest main from origin.
2. Read the assigned ops files.
3. Check the QA2-001 scope for required deployed-product flows.
4. Observe that the allowed task materials contain no deploy URL or usable test identities.
5. Stop before attempting guesses, scraping secrets, or using personal/production credentials.
screenshots_or_notes:
- No screenshots captured because no product target was available.
- No tokens, passwords, cookies, or secrets were read or written.
- No code was changed.
suspected_owner: unclear
next_needed:
- Provide the deployed product URL.
- Provide safe QA test identities or a documented login method for: normal user, authorized creator, and Backstage operator.
- Confirm whether image upload and object storage diagnostics should be tested on production or a staging deployment.
- Confirm whether a wallet adjustment confirmation modal can be opened using a safe test user with no actual balance change execution.
