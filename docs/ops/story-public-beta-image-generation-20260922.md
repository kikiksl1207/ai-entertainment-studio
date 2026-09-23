# Story public beta and scene image generation

## Scope

- Public surface: Story only. OTT is outside this beta.
- Approved works: the exact Imjin and Norse release tuples in `STORY_PUBLIC_BETA_RELEASES`.
- Reading requires sign-in. A beta allowlist entry may grant temporary free access without changing the commercial price.
- Scene prompts remain private. Public responses contain only approved asset proxy paths.
- An image prompt gets at most one provider attempt. A timeout or ambiguous failure is not retried automatically.

## Safe rollout order

1. Deploy the database migration and backend with both feature flags off.
2. Import and validate the authored story package. Do not fabricate author final-review or rights evidence.
3. Complete the real owner final review, rights confirmation, price review, and publication transition.
4. Register any legacy Imjin prompts against the exact active release checksum.
5. Set `STORY_PUBLIC_BETA_RELEASES` to the two exact work/release/checksum tuples.
6. Set `STORY_PUBLIC_BETA_ENABLED=true` and verify the catalog exposes only those tuples.
7. Verify durable S3/R2 storage, then set `STORY_IMAGE_GENERATION_ENABLED=true`.
8. Test one scene from each work before inviting testers.

Example allowlist shape:

```json
[
  {
    "workId": "00000000-0000-4000-8000-000000000000",
    "releaseId": "00000000-0000-4000-8000-000000000000",
    "releaseChecksum": "64-lowercase-hex-characters",
    "freeAccess": true
  }
]
```

## Image controls

- Default: `gpt-image-2`, `medium`, `1024x1536` portrait scenes, WebP. The separate published cover keeps its own aspect ratio.
- There is no default paid-attempt cap per work or across the catalog. First visits to distinct scenes are an investment; the same ready, release-bound image is reused by later readers.
- Operators can set `STORY_IMAGE_GENERATION_EMERGENCY_MAX_PER_WORK` or `STORY_IMAGE_GENERATION_EMERGENCY_MAX_TOTAL` to pause new attempts during an incident. Failed or ambiguous attempts count toward an enabled emergency limit; retries still require explicit handling.
- The server decodes the result, requires exact dimensions and one non-animated WebP frame, removes metadata, and stores the sanitized image.
- Ready images are immutable release-bound overlays. They do not modify canonical story manifests.
- Repeated readers reuse the stored asset and do not call the image provider again.

OpenAI image output cost changes over time. Review actual spend and reuse before enabling or adjusting emergency limits:

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/reference/cli/resources/images/methods/generate

## Stop switches

- Stop new image charges immediately: `STORY_IMAGE_GENERATION_ENABLED=false`.
- Hide the beta immediately: `STORY_PUBLIC_BETA_ENABLED=false`.
- Remove one work without changing publication data: remove its exact tuple from `STORY_PUBLIC_BETA_RELEASES`.
- Never delete or overwrite an existing prompt to correct it. Create and approve a new story release.

## Acceptance checks

- Anonymous users can discover only approved works; reading still requires sign-in.
- A beta-free work starts without wallet debit and retains its stored commercial price.
- The first visit to a scene without art may show a neutral fallback while generation runs.
- A second visit returns the stored asset and produces no provider call.
- A malformed image, timeout, storage failure, or stale release leaves the story readable and cannot retry automatically.
