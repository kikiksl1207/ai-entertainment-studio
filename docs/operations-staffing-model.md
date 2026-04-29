# Lumina Stage Operations Staffing Model

Lumina Stage should be operated like a small AI entertainment company, not just a software service.

This document defines how human staff, contractors, AI tooling, and backend systems should divide responsibilities.

## Operating principle

Each AI artist should be treated like an entertainment IP with production, management, content, and commercial operations.

The product platform provides:

- artist profiles
- assets
- shortforms
- premium videos
- gifts
- boosts/rankings
- chat features
- wallet/payment infrastructure

The operating team provides:

- character creation
- visual production
- SNS voice
- fan communication
- brand/ad planning
- performance direction
- voice/dubbing production

## Role map

### Casting / Character Production

Korean label: `섭외담당`

Primary responsibility:

- Create and refine AI artist concepts.
- Define character positioning, appearance direction, personality, and content potential.
- Coordinate AI image generation, SD/LoRA direction, reference boards, and character consistency.
- Prepare candidates for the initial lineup and future expansion.

Typical outputs:

- character sheets
- visual references
- generation prompts
- consistency guidelines
- launch priority proposals

System touchpoints:

- `artists`
- `artist_public_profiles`
- `artist_visual_profiles`
- `assets`
- `artist_assets`

### Artist Manager

Korean label: `매니저` or `엔터매니저`

Primary responsibility:

- Manage each character's public communication and fan relationship.
- Operate SNS tone, posting schedule, shortform concepts, and ad/commercial positioning.
- Decide how gifts, boosts, ranking results, and unlock events are reflected in the character's public activity.

Typical outputs:

- SNS captions
- shortform briefs
- fan event plans
- brand/ad proposals
- gift reaction ideas
- unlock content direction

System touchpoints:

- `shortforms`
- `gift_products`
- `artist_gift_progress`
- `artist_reaction_events`
- `artist_equipped_items`
- `boost_campaigns`
- `artist_ranking_snapshots`

### Choreography / Pose Direction

Korean label: `안무가`

Primary responsibility:

- Use OpenPose or similar pose pipelines for dance, stage, and motion reference.
- Turn music/performance direction into pose/motion inputs.
- Support shortform, premium video, and stage-style visual production.

Typical outputs:

- OpenPose reference sets
- dance pose sequences
- performance shot lists
- motion continuity notes

System touchpoints:

- `assets`
- `shortform_assets`
- `premium_video_assets`
- future production metadata for pose/motion sources

### Voice / Dubbing

Korean label: `목소리더빙` or `성우 섭외`

Primary responsibility:

- Source voice actors or voice production partners.
- Produce character voice samples, special replies, and premium voice content.
- Maintain voice identity per character.

Typical outputs:

- voice sample files
- special voice replies
- premium audio/video dubbing
- voice style guide

System touchpoints:

- `assets`
- `chat_feature_products`
- `chat_feature_orders`
- `chat_messages`
- future voice asset/profile tables if needed

## Practical MVP staffing

For the first commercial version, keep the human structure lean:

- 1 casting/character production owner
- 1 artist manager covering all initial characters
- freelance pose/choreography support as needed
- freelance voice actors only when premium video or voice reply tests begin

Do not hire role-by-role too early. Use contractors until repeatable production volume is proven.

## Future backend implications

The current backend does not need staff tables immediately.

When admin operations become more complex, add:

- `staff_profiles`
- `staff_assignments`
- `production_tasks`
- `content_briefs`
- `asset_review_states`

Recommended first backend expansion:

- Add operational status metadata to assets and content.
- Add admin audit visibility by content type.
- Add role-specific admin permissions only after real staff begin using the admin system.

## Notes

- Frontend user-facing pages should not expose internal staffing language.
- Public copy should say `Lumina Stage team`, `artist team`, or event-style language.
- Internal Notion and backend docs can use entertainment-style role labels.
