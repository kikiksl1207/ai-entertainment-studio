# Team2 QA Inbox

status: partial
task: Backstage wallet adjustment QA - single and bulk Lumina adjustments
environment:
- branch: team2-qa/backstage-wallet-adjustment-qa
- local main after pull: origin/main
- frontend: https://www.lumina-stage.com/backstage.html
- backend: https://api.lumina-stage.com
- No signed URL, direct upload URL, object URL, token, cookie, password, env value, or S3 credential was recorded.
- No real production user or real production amount was used.

summary:
- PASS: client-side empty note guard for single adjustment.
- PASS: client-side empty note guard for bulk adjustment.
- PASS: client-side confirmation modal summary for single adjustment.
- PASS: client-side confirmation modal summary for bulk adjustment.
- PASS: desktop confirmation modal layout at 1365px width.
- PASS: mobile/narrow confirmation modal layout at 390px and 320px width.
- NOT RUN: authenticated server-side wallet adjustment execution and debit insufficient-balance failure, because this QA session did not have a valid Backstage admin session or safe QA wallet credentials.
- STATIC CHECK ONLY: backend code rejects empty notes, placeholder notes, missing targets, invalid amount, and insufficient debit balance, and uses guarded debit update logic to avoid negative balances.

tested_flows:
- PASS: single adjustment with empty note did not open the confirmation modal.
- PASS: single adjustment with empty note sent 0 wallet-adjustment API requests.
- PASS: single adjustment with empty note showed an operator-facing message requiring a handling note: `처리 사유를 입력해 주세요. 예: 오픈 이벤트 지급 100L`.
- PASS: bulk adjustment with empty note did not open the confirmation modal.
- PASS: bulk adjustment with empty note sent 0 wallet-adjustment API requests.
- PASS: bulk adjustment with empty note showed the same operator-facing handling-note message.
- PASS: single adjustment with an operator-entered note opened the confirmation modal.
- PASS: single adjustment confirmation modal showed direction, amount, target count, and the exact operator-entered note.
- PASS: bulk adjustment with an operator-entered note opened the confirmation modal.
- PASS: bulk adjustment confirmation modal showed direction, amount, target count, and the exact operator-entered note.
- PASS: opening confirmation modals without clicking the final run button sent 0 wallet-adjustment API requests.
- PASS: desktop confirmation modal summary/action area did not overflow the viewport.
- PASS: 390px mobile confirmation modal summary/action area did not overflow the viewport.
- PASS: 320px narrow confirmation modal summary/action area did not overflow the viewport.

debit_safety:
- NOT RUN: actual authenticated debit against a safe QA wallet was not executed.
- STATIC CHECK: backend returns `BadRequestException` for insufficient debit balance.
- STATIC CHECK: backend debit path checks existing wallet balance before debit.
- STATIC CHECK: backend debit path uses `updateMany` with `cachedBalance: { gte: amount }`.
- STATIC CHECK: backend re-checks update count and throws `Insufficient Lumina balance for user ...` if debit cannot be applied.
- STATIC CHECK: returned policy includes `allowNegativeBalance: false`.
- STATIC CHECK: UI failure path displays the API error message in the confirmation modal if a server-side adjustment fails.

repro_steps:
1. Run `git pull origin main`.
2. Open `https://www.lumina-stage.com/backstage.html`.
3. For UI-only validation, render the Backstage dashboard with a non-sensitive local QA-only auth stub; do not click the final confirmation run button.
4. Open `단건 조정`.
5. Enter a safe QA-looking target email and amount, leave `처리 사유` empty.
6. Click `단건 조정 실행`.
7. Observe no confirmation modal and no wallet-adjustment API request.
8. Enter an operator-written note.
9. Click `단건 조정 실행`.
10. Observe the confirmation modal includes direction, amount, target count, and note.
11. Close the modal without running the action.
12. Repeat steps 4-11 for `대량 조정`.
13. Repeat confirmation modal layout checks at 1365px, 390px, and 320px viewport widths.

blockers:
- Auth/test-data blocker: no valid Backstage admin session or safe QA wallet credentials were available in this QA session, so actual server mutation and insufficient-balance debit behavior could not be exercised.

security_check:
- PASS: no signed URL was recorded.
- PASS: no direct upload URL was recorded.
- PASS: no object URL was recorded.
- PASS: no token, cookie, password, env value, or S3 credential was recorded.
- PASS: no actual wallet adjustment was executed.

suspected_owner: none for client-side validation; backend runtime debit safety still needs authenticated QA execution.

next_needed:
- Provide a valid Backstage admin QA session and safe QA wallet target(s).
- Run actual insufficient-balance debit against a safe QA wallet.
- Confirm server failure message and wallet balance display do not show a negative balance.
