# Min Chae-on (민채온) public-release asset inventory #277

Public-release character after Oh Hyerin (오혜린). The first cut ships with
13 confirmed gallery PNGs plus cover and thumb. 3 additional gallery shots
(slots 14–16) are flagged as a follow-up; they do not block the public
connection.

## Shipped files (current state, 2026-05-19)

Under `assets/characters/min-chaeon/site-selected/`:

| Slot | Filename | Status |
| --- | --- | --- |
| Cover | `cover.png` | ✅ Shipped |
| Thumb | `thumb.png` | ✅ Shipped |
| Gallery 1–13 | `gallery-01.png` … `gallery-13.png` | ✅ Shipped (13 PNGs) |
| Gallery 14–16 | `gallery-14.png` … `gallery-16.png` | ⏳ Follow-up reinforcement |

`data/characters.js`:

- `min-chaeon` sits in `siteSelectedSlugs` so the detail-page gallery grid
  runs through the shared loader.
- `siteSelectedGalleryConfig["min-chaeon"] = { count: 13, ext: "png" }`
  locks the gallery render at the 13 PNGs that actually exist. No 404 risk
  even though slots 14–16 are still pending.
- `images.cover` / `images.thumb` reference the PNGs under `site-selected/`.
- `tier: "sub"`, `status: "debut"` — same pattern as 오혜린, so the artist
  card renders the `데뷔 예정` badge and the artist is visible publicly
  alongside other pre-debut tier members.

The 18-SVG placeholder set is deleted; only the 15 final PNGs remain in
the folder.

## Adding the missing 3 gallery shots later

Drop `gallery-14.png`, `gallery-15.png`, `gallery-16.png` into the same
folder. Then bump `siteSelectedGalleryConfig["min-chaeon"].count` from
`13` to `16` — that single line ships the slots. No other code change.

## Visual QA checklist (already covered for the 13 set)

- 390 / 768 / 1280 px width: no horizontal overflow on grid, detail hero,
  gallery grid.
- Gallery lightbox loops 1 → 13 → 1 without 404.
- Mini profile (`user-profile.html` mini modal) uses the thumb.
- DM list shows the thumb.
- Search / filter chips include `min-chaeon`.
- Network panel: `assets/characters/min-chaeon/site-selected/*` HTTP 200,
  no 404, no mixed content.

## Sensitive value policy

- No real-person photos, real names, prompt text, or paid model references
  committed to the repo or to this doc.
- No signed S3 URLs, storage keys, or upload tokens in PR / Notion / chat.

## Handoff order

1. (Done by cloud, 2026-05-19) Wire 13 PNGs + tier/status switch + cleanup
   of SVG placeholders.
2. 조로: cherry-pick into main and deploy.
3. 큐알: 390 / 768 / 1280 px live regression and 404 check on the
   `assets/characters/min-chaeon/site-selected/` set.
4. 차모: 완료/보관 once QA passes.
5. 에밀리 (follow-up): deliver gallery-14..16 PNGs when ready; one-line
   config bump after that.
