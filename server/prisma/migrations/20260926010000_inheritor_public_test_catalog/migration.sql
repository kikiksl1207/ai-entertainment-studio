UPDATE "story_works"
SET "cover_manifest" = jsonb_set("cover_manifest"::jsonb, '{catalogVisibility}', '"public_test"'::jsonb)
WHERE "slug" LIKE 'the-killer-inherits-the-dead-%'
  AND "title"->>'ko' = '살인자는 죽은 자의 능력을 계승한다'
  AND "status" = 'published'
  AND "active_release_id" IS NOT NULL
  AND "cover_manifest"->>'contentRating' = 'adults_only'
  AND "cover_manifest"->>'catalogVisibility' = 'unlisted';
