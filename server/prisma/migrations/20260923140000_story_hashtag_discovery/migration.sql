ALTER TABLE "story_works"
  ADD COLUMN "hashtag_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "hashtag_labels" JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '';

CREATE INDEX "idx_story_works_hashtag_keys"
  ON "story_works" USING GIN ("hashtag_keys");

CREATE OR REPLACE FUNCTION "refresh_story_work_search_text"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."search_text" := LOWER(CONCAT_WS(' ', NEW."title"::TEXT, NEW."summary"::TEXT, NEW."hashtag_labels"::TEXT));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_story_works_search_text"
BEFORE INSERT OR UPDATE OF "title", "summary", "hashtag_labels"
ON "story_works"
FOR EACH ROW
EXECUTE FUNCTION "refresh_story_work_search_text"();

UPDATE "story_works"
SET
  "hashtag_keys" = ARRAY['history', 'imjin-war', 'yi-sun-sin', 'war', 'choice-fiction'],
  "hashtag_labels" = '{
    "history":{"ko":"역사","en":"History","ja":"歴史","zh-Hans":"历史","zh-Hant":"歷史"},
    "imjin-war":{"ko":"임진왜란","en":"Imjin War","ja":"文禄・慶長の役","zh-Hans":"壬辰倭乱","zh-Hant":"壬辰倭亂"},
    "yi-sun-sin":{"ko":"이순신","en":"Yi Sun-sin","ja":"李舜臣","zh-Hans":"李舜臣","zh-Hant":"李舜臣"},
    "war":{"ko":"전쟁","en":"War","ja":"戦争","zh-Hans":"战争","zh-Hant":"戰爭"},
    "choice-fiction":{"ko":"선택형스토리","en":"Interactive story","ja":"選択型ストーリー","zh-Hans":"互动故事","zh-Hant":"互動故事"}
  }'::JSONB
WHERE "slug" = 'records-of-the-burning-sea-imjin-war';

UPDATE "story_works"
SET
  "hashtag_keys" = ARRAY['norse-mythology', 'mythology', 'fantasy', 'loki', 'choice-fiction'],
  "hashtag_labels" = '{
    "norse-mythology":{"ko":"북유럽신화","en":"Norse mythology","ja":"北欧神話","zh-Hans":"北欧神话","zh-Hant":"北歐神話"},
    "mythology":{"ko":"신화","en":"Mythology","ja":"神話","zh-Hans":"神话","zh-Hant":"神話"},
    "fantasy":{"ko":"판타지","en":"Fantasy","ja":"ファンタジー","zh-Hans":"奇幻","zh-Hant":"奇幻"},
    "loki":{"ko":"로키","en":"Loki","ja":"ロキ","zh-Hans":"洛基","zh-Hant":"洛基"},
    "choice-fiction":{"ko":"선택형스토리","en":"Interactive story","ja":"選択型ストーリー","zh-Hans":"互动故事","zh-Hant":"互動故事"}
  }'::JSONB
WHERE "slug" = 'norse-myth-loki-crossroads';

UPDATE "story_works"
SET
  "hashtag_keys" = ARRAY['romance', 'mystery', 'fantasy', 'modern-korea', 'complete'],
  "hashtag_labels" = '{
    "romance":{"ko":"로맨스","en":"Romance","ja":"ロマンス","zh-Hans":"浪漫","zh-Hant":"浪漫"},
    "mystery":{"ko":"미스터리","en":"Mystery","ja":"ミステリー","zh-Hans":"悬疑","zh-Hant":"懸疑"},
    "fantasy":{"ko":"판타지","en":"Fantasy","ja":"ファンタジー","zh-Hans":"奇幻","zh-Hant":"奇幻"},
    "modern-korea":{"ko":"현대한국","en":"Modern Korea","ja":"現代韓国","zh-Hans":"现代韩国","zh-Hant":"現代韓國"},
    "complete":{"ko":"완결","en":"Completed","ja":"完結","zh-Hans":"完结","zh-Hant":"完結"}
  }'::JSONB
WHERE "slug" = 'the-monster-that-did-not-eat-my-name';

UPDATE "story_works"
SET
  "hashtag_keys" = ARRAY['romance', 'political-fantasy', 'mystery', 'court-intrigue', 'complete'],
  "hashtag_labels" = '{
    "romance":{"ko":"로맨스","en":"Romance","ja":"ロマンス","zh-Hans":"浪漫","zh-Hant":"浪漫"},
    "political-fantasy":{"ko":"정치판타지","en":"Political fantasy","ja":"政治ファンタジー","zh-Hans":"政治奇幻","zh-Hant":"政治奇幻"},
    "mystery":{"ko":"미스터리","en":"Mystery","ja":"ミステリー","zh-Hans":"悬疑","zh-Hant":"懸疑"},
    "court-intrigue":{"ko":"궁정암투","en":"Court intrigue","ja":"宮廷陰謀","zh-Hans":"宫廷权谋","zh-Hant":"宮廷權謀"},
    "complete":{"ko":"완결","en":"Completed","ja":"完結","zh-Hans":"完结","zh-Hant":"完結"}
  }'::JSONB
WHERE "slug" = 'we-wrote-rebellion-on-each-others-bodies';

UPDATE "story_works"
SET "search_text" = LOWER(CONCAT_WS(' ', "title"::TEXT, "summary"::TEXT, "hashtag_labels"::TEXT));
