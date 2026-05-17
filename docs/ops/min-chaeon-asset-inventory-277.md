# Min Chae-on (민채온) public-release asset inventory #277

Next public-release character after Oh Hyerin (오혜린). 18 SVG **placeholders**
are already committed under `assets/characters/min-chaeon/site-selected/` so
the gallery and the cover/thumb wires up end-to-end without 404s. Emily's
final PNG set drops in on the same paths and the swap is a two-line config
edit, no JS logic change.

## Required files (final delivery)

Drop them under `assets/characters/min-chaeon/site-selected/` (same folder
convention as `oh-hyerin/site-selected/`). PNG, max 1.5 MB each, sRGB.

| Slot | Filename | Purpose |
| --- | --- | --- |
| Cover | `cover.png` | Character detail hero, mypage carousel, share OG card |
| Thumb | `thumb.png` | Character grid / DM list / mini profile |
| Gallery 1–16 | `gallery-01.png` … `gallery-16.png` | Detail page gallery grid + lightbox |

Total = 18 files. Filenames are case-sensitive and must match exactly,
zero-padded to two digits (`gallery-01.png`, not `gallery-1.png`).

## Current state (placeholders shipped)

While Emily is unavailable, 18 SVG placeholders are checked in:

```
assets/characters/min-chaeon/site-selected/
  cover.svg                  (1024 × 1024)
  thumb.svg                  (512 × 512)
  gallery-01.svg .. gallery-16.svg   (768 × 768 each)
```

Each placeholder is a gradient card in the persona accent color (`#f0b0c0`)
with the labels `Min Chae-on` / slot name (`Cover`, `Thumbnail`,
`Gallery 01`…`Gallery 16`) / `Awaiting final photo set (#277)`. These read
clearly on the site and signal at a glance that they are stand-ins.

`data/characters.js` is wired:

- `min-chaeon` is included in `siteSelectedSlugs` so the detail-page gallery
  grid renders 16 slots.
- The new `siteSelectedGalleryConfig` lookup maps `min-chaeon` to
  `{ count: 16, ext: "svg" }`. Every other slug keeps the existing default
  (`count: 14`, `ext: "png"`).
- `images.cover` and `images.thumb` point at the SVG placeholders in
  `site-selected/`.
- `status: "secret"` and `tier: "candidate"` are kept. The card still shows
  as `비공개 라인` so users see a clear stand-in, not a half-done public
  artist.

## Swap to final PNGs (after Emily delivers 18 PNG files)

Drop the PNGs at the paths in the table above. Then edit `data/characters.js`:

1. Replace the `siteSelectedGalleryConfig["min-chaeon"]` entry with
   `{ count: 16, ext: "png" }` (or simply delete the entry if Emily provides
   the standard 14 instead of 16 — the default falls back to `.png` / 14).
2. Change the inline `images` block on line 188 back to `.png`:
   ```js
   images: {
     cover: "./assets/characters/min-chaeon/site-selected/cover.png",
     thumb: "./assets/characters/min-chaeon/site-selected/thumb.png"
   }
   ```
3. Flip `status: "secret"` → `status: "active"` (or whatever the live tier
   uses for promoted artists) so the public artist grid shows the card
   without the `비공개 라인` badge.
4. `tier: "candidate"` → `tier: "official"` when settlement / contract / debut
   readiness are agreed by 차모. Until then keep `candidate` so business copy
   stays accurate.
5. (Optional cleanup) Delete the 18 `.svg` placeholders once the PNG set is
   verified — the gallery only references the `.png` versions after step 1.

## Visual QA checklist (after each swap)

- 390 / 768 / 1280 px width: no horizontal overflow on grid, detail hero,
  gallery grid.
- Gallery lightbox loops 1 → 16 → 1 without 404.
- Mini profile (`user-profile.html` style mini modal) uses the thumb.
- DM list shows the thumb.
- Search / filter chips include the new active slug.
- Network panel: every `assets/characters/min-chaeon/site-selected/*` is HTTP
  200, no 404s, no mixed content.

## Sensitive value policy

- Do not commit real-person photos, real names, prompt text, or paid model
  references in the repo or in this doc.
- Do not record signed S3 URLs, storage keys, or upload tokens in PR / Notion
  / chat. Use the regular character-asset upload path.

## Handoff order

1. (Done by cloud) 18 SVG placeholders + wiring.
2. 에밀리 (or whoever produces images): final 18 PNG set + share OG card check.
3. 클라우드: apply the two-line swap in `data/characters.js` above.
4. 뷰어: review the detail page + grid screenshots.
5. 조로: merge + deploy.
6. 큐알: 390 / 768 / 1280 px live regression and 404 check.
