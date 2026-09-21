import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260921234500_story_ai_shared_result_cache/migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

describe('shared story AI result migration candidate', () => {
  it('is transactional and adds a neutral registry without reader or private input columns', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    const table = migration.slice(
      migration.indexOf('CREATE TABLE "story_ai_reusable_results"'),
      migration.indexOf('CREATE TABLE "story_ai_reusable_beats"'),
    );
    expect(table).not.toMatch(/"user_id"|"progress_id"|"custom_choice"|"private_input"/);
    expect(schema.slice(
      schema.indexOf('model StoryAiReusableResult'),
      schema.indexOf('model StoryAiReusableBeat'),
    )).not.toMatch(/userId|progressId|customChoice|privateInput/);
  });

  it('binds exact release, manuscript and canonical source ownership', () => {
    for (const constraint of [
      'story_ai_reusable_results_release_work_fk',
      'story_ai_reusable_results_manuscript_work_fk',
      'story_ai_reusable_results_source_choice_fk',
      'story_ai_reusable_results_source_shared_fk',
      'story_ai_continuations_shared_result_owner_fk',
      'story_ai_generated_scenes_shared_result_owner_fk',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraint}"`);
    }
    expect(migration).toContain('story_ai_continuations_reuse_tuple_check');
    expect(migration).toContain('story_ai_generated_scenes_reuse_provenance_check');
    expect(migration).toContain('DROP CONSTRAINT "story_ai_generated_scenes_provenance_check"');
    expect(migration).toContain('generated reusable result requires an approved shared source');
  });

  it('enforces unique identity, immutable snapshots and approved-only complete outputs', () => {
    expect(migration).toContain('story_ai_reusable_results_reuse_key_key');
    expect(migration).toContain('story_ai_reusable_results_lifecycle_check');
    expect(migration).toContain('story_ai_reusable_results_nonempty_snapshot_check');
    expect(migration).toContain('story_ai_reusable_beats_type_check');
    expect(migration).toContain('story_ai_reusable_choices_key_check');
    expect(migration).toContain('"source_shared_choice_key" <> \'\'');
    expect(migration).toContain('story AI reusable result snapshot is immutable');
    expect(migration).toContain('story AI reusable result children are immutable');
    expect(migration).toContain('story AI reusable result output is incomplete');
    expect(migration).toContain("OLD.\"status\" = 'pending' AND NEW.\"status\" IN ('pending', 'approved', 'revoked')");
  });

  it('leaves legacy continuations valid and uses nullable all-or-none reuse references', () => {
    expect(migration).toContain('num_nonnulls("reusable_context_fingerprint", "reuse_key", "shared_result_id") IN (0, 3)');
    expect(migration).not.toMatch(/UPDATE\s+"story_ai_continuations"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });
});
