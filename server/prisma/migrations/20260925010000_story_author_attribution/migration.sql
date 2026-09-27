ALTER TABLE "story_works" ADD COLUMN "author_display_name" VARCHAR(80);

UPDATE "story_works"
SET "author_display_name" = '루미나',
    "search_text" = trim("search_text" || ' 루미나')
WHERE "slug" IN (
  'records-of-the-burning-sea-imjin-war',
  'norse-myth-loki-crossroads',
  'the-monster-that-did-not-eat-my-name',
  'we-wrote-rebellion-on-each-others-bodies'
)
AND "author_display_name" IS NULL;
