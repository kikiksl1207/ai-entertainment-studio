# Team2 QA Inbox

status: pass
task: Fan engagement Home teaser smoke QA
environment:
- branch: team2-qa/fan-engagement-home-teaser-smoke
- local main after pull: origin/main
- basis commit: f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b
- page: https://www.lumina-stage.com/index.html
- No token, cookie, password, env value, or credential was recorded.
- No API submit, mission participation, or ballot mutation was executed.

tested_flows:
- PASS: `index.html` renders the fan mission teaser section.
- PASS: teaser renders exactly 3 mission cards.
- PASS: Korean copy is displayed normally in the browser.
- PASS: raw enum / English key strings were not exposed in the teaser UI.
- PASS: all 3 CTA buttons are disabled.
- PASS: clicking disabled CTAs did not create any mission API request, submit, participation mutation, or ballot mutation.
- PASS: desktop 1365px layout has no card or text overlap.
- PASS: mobile 390px layout has no card or text overlap.
- PASS: narrow 320px layout has no card or text overlap.
- PASS: existing Home hero is present.
- PASS: existing main artists section is present.
- PASS: existing shortform section is present and populated.
- PASS: existing debut line carousel is present and populated.

observed_copy:
- Section heading: `팬 미션`, `오늘의 팬 참여`.
- Card copy included `오늘의 응원 미션`, `오늘의 콘셉트 투표`, `한 줄 제안`.
- Card metadata included Korean labels such as `응원 미션`, `콘셉트 투표`, `팬 제안`, `진행 중`, `참여 가능`, `확인 중`, and `팬 포인트 +5`.

network_check:
- PASS: click delta after forcing clicks on the 3 disabled CTAs was 0 mission-related requests.
- PASS: no `mission_participation` mutation was observed.
- PASS: no `ballot` mutation was observed.
- Note: page load emitted a third-party analytics POST unrelated to mission participation or ballot submission.

responsive_check:
- desktop 1365x900: 3 cards visible, no card overlap, no text overflow.
- mobile 390x844: 3 cards visible, no card overlap, no text overflow.
- narrow 320x740: 3 cards visible, no card overlap, no text overflow.

repro_steps:
1. Run `git pull origin main`.
2. Confirm local `HEAD` is `f94ffd2ae1aee3c0d100a07d9aa508a702a5a79b`.
3. Open `https://www.lumina-stage.com/index.html`.
4. Inspect `#fan-missions` and `#homeMissionTeaser`.
5. Confirm exactly 3 `.fan-mission-card` elements render.
6. Confirm `.fan-mission-cta` buttons are disabled.
7. Force-click each disabled CTA while monitoring network requests.
8. Confirm no mission participation, ballot, submit, or mutation request is sent.
9. Repeat visual checks at 1365px, 390px, and 320px widths.
10. Confirm Home hero, main artists, shortform, and debut line carousel still render.

blockers:
- None found.

security_check:
- PASS: no sensitive values were recorded.
- PASS: no submit or mutation was executed.

next_needed:
- No follow-up required for this smoke scope.
