# Story And Artist Upload Generation Profile

## Purpose

An uploaded manuscript or image is source evidence, not a complete generation
instruction. Lumina Stage analyzes the upload, proposes editable settings, and
uses only creator-approved settings for story continuation and scene artwork.

The product must preserve two identities at the same time:

- The story owns its writing style, period, world, palette, costumes and scene
  continuity.
- A participating artist or recurring character owns their recognizable face,
  hair, body proportions and signature traits.

Entering a story adapts the artist to the story's visual language. It must not
redesign the artist as a different person.

## Approval Flow

1. The creator uploads a manuscript and optional branch, ending and visual
   files.
2. The system extracts a private draft profile from those files.
3. The creator sees a review modal with the inferred values, source evidence
   and questions for ambiguous items.
4. The creator can accept, edit, remove or mark an item as intentionally
   unknown.
5. The creator approves one immutable profile version.
6. Story and image generation are blocked when the required approved profile
   is missing, stale, or belongs to a different source checksum.
7. A revised upload creates a new draft. It never silently changes an active
   profile or previously generated scenes.

AI analysis completion is not approval. Creator approval and source binding
must be stored separately and audited.

## Writer Profile

The manuscript analysis draft must propose these settings:

| Area | Required output |
| --- | --- |
| Writing style | Point of view, tense, sentence rhythm, paragraph density, dialogue pattern, description density and prohibited style changes |
| Scene scale | Typical characters per part and per scene, acceptable continuation range, chapter/part boundaries and natural stopping rules |
| Canon | World rules, fixed historical or fictional facts, character identities, relationships, abilities, injuries, deaths and possessions |
| Timeline | Current date or era, relative elapsed time, character ages, location history and event order |
| Narrative devices | Open foreshadowing, resolved payoffs, mysteries, promises and facts that must not be revealed early |
| Branch behavior | Choice consequences, allowed rejoin points, authored endings, forbidden forced convergence and ending conditions |
| Visual direction | Era, geography, architecture, costume rules, master art style, palette, lighting range and prohibited elements |
| Visual cast | Recurring character appearance anchors, approved reference images, signature items and scene-specific costume states |

Style observations must be backed by manuscript excerpts. They are writing
pattern evidence, not permission to quote or reproduce the source verbatim.

## Artist Identity Profile

The artist review draft is built from the images and profile information the
artist uploads. At least one front or three-quarter face reference is required
before the artist can participate in generated story scenes.

The approved profile separates fixed identity from adaptable presentation:

### Fixed identity

- Facial structure and age range
- Skin tone
- Eye shape and color
- Hairline, core hair shape and color
- Body proportions
- Distinctive marks and signature traits
- Approved reference asset IDs and checksums

### Adaptable presentation

- Story-era hairstyle variation that does not change identity
- Costume, armor and accessories required by the story
- Rendering medium and line or paint treatment
- Scene lighting, expression, pose and camera angle
- Temporary state such as dirt, injury, wet clothing or age progression when
  the approved story state requires it

The review UI must show an explicit preview of the artist in the target story
style before approval. A text description alone is not sufficient evidence of
identity consistency.

## Scene Generation Lock

Every choice creates one immutable scene-generation lock before a provider is
called. The lock contains:

- Work, release and manuscript checksums
- Approved writer-profile version and fingerprint
- Approved visual-bible version and fingerprint
- Selected choice and complete branch-path hash
- Current time, location, cast, relationships, injuries, possessions,
  unresolved foreshadowing and ending eligibility
- Participating artist-profile versions and reference-asset checksums
- Locale and generation-policy versions

The same lock drives both prose and artwork. A scene image must be generated
from the validated result of that exact prose generation, never from the old
scene, only the choice label, or an unrelated generic prompt.

## Generation Sequence

1. Accept the choice once and save the source state.
2. Build and fingerprint the scene-generation lock.
3. Generate the new title, prose, next choices or ending, and a structured
   scene description.
4. Validate style, canon, timeline, branch consequences and unresolved
   narrative devices.
5. Generate artwork from the validated scene description, the story visual
   bible and approved character or artist reference images.
6. Validate identity, period, cast, costume, location and image quality.
7. Save prose, artwork and the lock fingerprint together.
8. Reveal the next scene only when both prose and required artwork are ready.

If artwork is still running, the reader remains in a generation-wait state.
The player must not show the previous scene's image, a random fallback image,
or mark the next scene fully ready. A retry reuses the same lock and does not
charge for or regenerate completed work unnecessarily.

## Reuse

An approved result can be reused only when all of these match:

- Release and manuscript checksums
- Branch-path and selected-choice hashes
- Writer-profile and visual-bible fingerprints
- Current scene-state fingerprint
- Participating artist-profile fingerprints
- Locale and generation-policy versions

Changing an artist reference, manuscript, visual bible, author approval or
branch state invalidates the reuse key. Existing reader history remains bound
to the version it originally used.

## Review Modal

The final upload action opens one review flow rather than immediately
publishing. It groups only items that need a human decision:

- Inferred writing and visual style
- Main recurring characters and their reference images
- Timeline or setting ambiguities
- Possible foreshadowing and later payoffs
- Conflicts with earlier parts
- Proposed branch points and consequence summaries
- Missing rights, identity references or generation permissions

Every item provides `accept`, `edit`, `remove`, or `unknown` where appropriate.
The final button is enabled only when all blocking items are resolved. The
approved profile is versioned and can be inspected later by the creator and an
authorized administrator.

## Delivery Order

1. [Complete] Persist draft and approved writer/artist profiles with source
   fingerprints.
2. [Complete] Add creator review and approval APIs with ownership and audit
   protection.
3. [Complete] Add the writer and artist review UI, including mobile and five
   locales.
4. [Complete] Pin the exact approved writer profile to continuation context,
   cache identity and provider dispatch. Include its approved visual sections
   in the branch-art prompt.
5. [Complete] Let a reader select one registered artist for a story from prior
   likes or votes, or find any active registered artist by exact search. Pin
   the selected artist profile version, approved identity fingerprint and
   reference-asset checksums to that reader's immutable story progress.
6. [Complete] Send the approved reference images and their verified checksums,
   not only analyzed text constraints, to the image-edit provider. Keep visual
   reuse isolated by the selected participant fingerprint.
7. [Complete] Gate generated-scene delivery on a paired prose-and-artwork ready
   state. While artwork is pending or failed, title, prose and choices remain
   hidden and the reader sees only a bounded wait or retry state.
8. [Complete] Cover participant-specific visual variants, reference-image
   transport, paired delivery and existing visual retry/failure behavior with
   server and source-contract regression tests.

The runtime now analyzes artist references, lets the reader select an eligible
registered artist, and locks that creator-approved identity into story
progress, continuation context, visual prompts and participant-specific image
reuse. Approved reference images are passed to the image-edit provider and an
AI-generated scene is not revealed until its prose and artwork are both ready.
