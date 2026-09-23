# Four-clip interactive OTT handoff

This is a private playback preparation, not a public release or a finished film. Do not add an OTT catalog entry until the actual clips, rights, translations, and playback approval have been checked.

## Clip graph

| Node | Actual video needed | Ending |
| --- | --- | --- |
| A | Korean-set mother and infected child; the child pursues her and falls | Last seconds show three choices over the still-playing video |
| B | Mother returns, helps the child up, and is bitten | Separate branch ending |
| C | Mother leaves and escapes | Separate branch ending |
| D | Mother hesitates; soldiers arrive; gunfire and outcome are implied offscreen without a graphic impact | Separate branch ending |

Connect A to B, C, and D as three distinct server-authored choices. Do not point the three choices to the same clip or insert a forced immediate rejoin. The private graph preview accepts the immutable `manifestId` or `previewId`; add `endScreen=1` to test the overlay. The ordinary owner preview remains available without that flag. The end screen appears during the final quarter of a short clip, capped at eight seconds before its end, and remains on the stopped final frame until the viewer chooses. Trim A so the child's fall is in that reveal window; verify timing against the delivered footage.

The four clips must keep the mother, child, costumes, setting, weather, and direction of movement consistent. Provide Korean audio and timecoded subtitles for the existing five locales (ko, en, ja, zh-Hans, zh-Hant) when approved. Missing translations must stay unavailable, not be improvised by the player. Choice keys and destinations stay server-authored; a browser must not construct or guess media URLs. A chosen path is persisted and the same approved result can be replayed without generating a new film.

## Acceptance before public release

- Confirm the rights and allowed transformation/use of the source, music, voices, and each generated asset. The user's rights statement does not itself upload or verify the files.
- Confirm all four clips are present and independently decodable; no stand-in clip or repeated B/C/D file.
- Check the choice cue against the fall, the offscreen treatment of D, the three labels, and each resulting clip.
- Check 390px, 400px, desktop, and remote/keyboard focus; check subtitles do not become unreadable under the overlay.
- Confirm public access, billing, and release approval separately from this owner-private preview.
