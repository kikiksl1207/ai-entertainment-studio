import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260921213000_story_recommended_ai_runtime/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
const economicsSource = readFileSync(join(__dirname, 'story-economics.service.ts'), 'utf8');
const repositorySource = readFileSync(join(__dirname, 'story-continuation.repository.ts'), 'utf8');

describe('recommended story continuation migration candidate', () => {
  it('backfills legacy custom requests transactionally before enforcing exactly one source', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('"request_kind" = \'custom_choice\'');
    expect(migration).toContain('story_ai_continuation backfill dependency mismatch');
    expect(migration).toMatch(/"request_kind" = 'custom_choice'[\s\S]+"custom_choice_id" IS NOT NULL[\s\S]+"recommended_choice_id" IS NULL/);
    expect(migration).toContain('num_nonnulls("recommended_choice_id", "generated_choice_id") = 1');
  });

  it('ties progress, release, part, scene, choice, manuscript, analysis, consent and rights pins together', () => {
    for (const constraint of [
      'story_ai_continuations_progress_work_fk',
      'story_ai_continuations_progress_owner_fk',
      'story_ai_continuations_release_work_fk',
      'story_ai_continuations_part_work_fk',
      'story_ai_continuations_scene_part_fk',
      'story_ai_continuations_recommended_choice_scene_fk',
      'story_ai_continuations_manuscript_work_fk',
      'story_ai_continuations_analysis_work_fk',
      'story_ai_continuations_style_work_fk',
      'story_ai_continuations_rights_version_fk',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraint}"`);
    }
    expect(migration).toContain("choice.\"route_kind\" = 'generation_required'");
    expect(migration).toContain('choice."target_scene_id" IS NULL');
    expect(migration).toContain('story_ai_continuations_recommended_pins_check');
    expect(migration).toContain("contract.\"work_type\" = 'story'");
    expect(migration).toContain('contract."work_id" = NEW."work_id"');
    expect(migration).toContain('version."content_version_id" = NEW."manuscript_version_id"');
    expect(migration).toContain('story_ai_generated_scenes_continuation_owner_fk');
    expect(migration).toContain('story_ai_continuations_generated_choice_scene_fk');
    expect(migration).toContain('story_reader_progress_current_scene_xor_check');
    expect(migration).toContain('story_ai_continuations_recommended_result_overlay_check');
    expect(migration).toMatch(/NEW\."generated_choice_id" IS NOT NULL[\s\S]+scene\."progress_id" = NEW\."progress_id"/);
    expect(migration).toMatch(/UPDATE OF[\s\S]+"generated_choice_id"[\s\S]+"rights_contract_version_id"/);
  });

  it('defines bounded claim and context cache indexes consistently with Prisma', () => {
    expect(migration).toContain('idx_story_ai_continuations_claim');
    expect(migration).toContain('idx_story_ai_continuations_cache');
    expect(migration).toContain('idx_story_ai_continuations_generated_choice');
    expect(schema).toMatch(/requestKind\s+String\s+@default\("custom_choice"\)/);
    expect(schema).toMatch(/recommendedChoiceId\s+String\?/);
    expect(schema).toMatch(/contextFingerprint\s+String/);
    expect(schema).toMatch(/leaseExpiresAt\s+DateTime\?/);
    expect(schema).toContain('model StoryAiGeneratedScene');
    expect(schema).toMatch(/resultGeneratedSceneId\s+String\?/);
    expect(schema).toMatch(/resultChecksum\s+String/);
    expect(migration).toContain('idx_story_ai_generated_scenes_reuse_candidate');
    expect(migration).toContain('story_ai_generated_scenes_provenance_check');
  });

  it('persists recommended results only into reader-owned overlay tables', () => {
    const settlement = economicsSource.slice(
      economicsSource.indexOf('async settleContinuation('),
      economicsSource.indexOf('private settlementProjection'),
    );
    expect(settlement).toContain('storyAiGeneratedScene.create');
    expect(settlement).toContain('storyAiGeneratedBeat.create');
    expect(settlement).toContain('storyAiGeneratedChoice.create');
    expect(settlement).not.toContain('storyScene.create');
    expect(settlement).not.toContain('storyBeat.create');
    expect(settlement).not.toContain('storyChoice.create');
    expect(settlement).toContain('resultSceneId: null');
    expect(settlement).toContain('resultGeneratedSceneId');
  });

  it('claims expired final attempts for terminal recovery and pins provider idempotency', () => {
    expect(repositorySource).toContain('attempt_count >= max_attempts');
    expect(repositorySource).toContain("status = 'processing'");
    expect(repositorySource).toContain('lease_expires_at < CURRENT_TIMESTAMP');
    expect(repositorySource).toContain('operationId: row.id');
  });
});
