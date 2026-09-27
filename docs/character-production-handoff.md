# Character Production Handoff

## Purpose

This is the operating contract for adding artists in batches. It keeps a new
artist coherent across the public profile, cover, thumbnail, gallery, and five
locale copy without inventing real-world credentials.

## Sources of truth

- Canonical public character data: `data/characters.js`.
- Detail-page profile rendering: `pages/character-detail.js` and
  `character-detail/index.html#detailProfile`.
- Detail-page mobile styles: `styles/character-detail.css`.
- Visual continuity rules: `docs/character-consistency-guide.md` and the
  character's selected cover, thumbnail, and reference images.

Use an existing artist's stated role, intro, concept, tags, and approved visual
references as evidence. Do not add an unverified real employer, contract,
award, revenue, debut date, location, body measurement, legal credential, or
other sensitive personal fact.

## Batch Packet

Create one packet per artist before writing copy or generating images.

| Field | Required handoff content |
| --- | --- |
| Identifier | `slug`, public name, role, type, public status |
| Canon | One-sentence role, intro, concept, tags, approved visual reference paths |
| Profile | Fifteen entries; see the profile schema below |
| Image brief | Fixed visual traits, allowed situation change, and prohibited elements |
| Copy | Korean canonical text plus five-locale key names and length limits |
| QA | 390px and 400px results, overflow, line count, and graphic-text changes |

Do not mark a character ready because an image exists. Cover and thumbnail
must read as the same person, and the profile must agree with the image brief.

## Profile Schema

The current public renderer displays `artist.profile` in insertion order. Keep
the seven existing identity fields intact and add the following editorial
fields to reach fifteen entries when they are not already present:

1. `콘텐츠포맷`
2. `대표장면`
3. `대화톤`
4. `함께하는방식`
5. `관심주제`
6. `시그니처`
7. `팬과의약속`
8. `휴식루틴` only when the artist does not already have `MBTI`

The added fields describe the fictional public persona, not a factual
biography. They must be derivable from the artist's role, intro, concept, or
tags. Keep a value to one mobile-friendly sentence: Korean 42 characters or
fewer; English 68 characters or fewer; Japanese 36 characters or fewer;
Chinese 28 characters or fewer. Avoid more than two visual lines at 390px.

## Five-Locale Contract

Keep Korean as the canonical writing source. For every new profile value, hand
off these replaceable keys even when the detail renderer has not yet adopted
per-profile locale data:

```text
artist.profile.label.<field>
artist.profile.<slug>.<field>
```

`<field>` uses lower camel case: `contentFormat`, `signatureMoment`,
`conversationTone`, `togetherStyle`, `interestTopics`, `signature`,
`fanPromise`, and `resetRoutine`. The target locale slots are `ko`, `en`,
`ja`, `zh-Hans`, and `zh-Hant`. Do not copy Korean into another locale and call
it translated. Until a locale value is reviewed, keep the Korean fallback and
mark the target slot `draft`; a dictionary replacement must not require a
layout or schema change.

Shared labels should remain short: Korean 8 characters, English 18 characters,
Japanese 10 characters, and Chinese 6 characters or fewer. Value limits above
are the source QA budget, not a reason to truncate an essential safety notice.

## Image and Graphic Copy QA

- Read the character's image guide before generation. Fixed face, hair, body,
  overall mood, and prohibited elements do not change across cuts.
- Cover: one person, full body or an unambiguous full-body composition.
- Thumbnail: face or shoulder-up composition, recognizable at small size.
- Do not put text or watermark in generated art unless a separately approved
  graphic copy task explicitly requires it.
- Record every changed graphic phrase, source file, locale scope, and a short
  stakeholder summary. Image-only replacements still need a summary when they
  alter the artist's public impression.

## Mobile QA

Check the public detail page at 390px and 400px after the copy is wired.

- Profile labels and values wrap naturally without clipping or horizontal
  overflow.
- Profile values stay within two lines where practical; revise copy before
  shrinking type.
- The profile block does not collide with gallery controls, tabs, or CTA.
- Check the longest English and Chinese strings, not Korean only.
- Confirm no raw i18n key, internal fixture wording, secret, or credential is
  present in user-facing text.

## Batch Completion Note

Each batch report includes the artist slugs, changed profile entries, copy key
prefix, 390/400px result, image or graphic-text impact, remaining translation
status, commit, and the next actual owner. Route a code integration to Chamo;
route independent visual review to Viewer.
