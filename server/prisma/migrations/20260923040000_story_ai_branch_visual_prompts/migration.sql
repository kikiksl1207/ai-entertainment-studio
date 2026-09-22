ALTER TABLE "story_visual_prompts"
  DROP CONSTRAINT "story_visual_prompts_source_kind";

ALTER TABLE "story_visual_prompts"
  ADD CONSTRAINT "story_visual_prompts_source_kind" CHECK (
    "source_kind" IN ('authored_import', 'admin_verified', 'ai_branch')
  );
