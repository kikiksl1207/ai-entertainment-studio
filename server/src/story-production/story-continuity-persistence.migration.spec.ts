import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260921170000_story_continuity_persistence_guard/migration.sql',
  ),
  'utf8',
).replace(/\s+/g, ' ').trim();
const schema = readFileSync(
  join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
).replace(/\s+/g, ' ');

describe('story continuity persistence migration', () => {
  it('ties entries, issues, and evidence links to one analysis version', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "uq_story_analysis_jobs_id_version" ON "story_analysis_jobs"("id", "analysis_version")',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "uq_story_analysis_evidence_job_id" ON "story_analysis_evidence"("analysis_job_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("analysis_job_id", "analysis_version") REFERENCES "story_analysis_jobs"("id", "analysis_version")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("analysis_job_id", "entry_id") REFERENCES "story_continuity_entries"("analysis_job_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("analysis_job_id", "issue_id") REFERENCES "story_continuity_issues"("analysis_job_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("analysis_job_id", "evidence_id") REFERENCES "story_analysis_evidence"("analysis_job_id", "id")',
    );
  });

  it('fails legacy null, object, scalar, and non-string-array evidence before expansion', () => {
    expect(migration).toContain(
      '"evidence_ids" IS NULL OR jsonb_typeof("evidence_ids") IS DISTINCT FROM \'array\'',
    );
    expect(migration).toContain(
      'jsonb_typeof(element."value") IS DISTINCT FROM \'string\'',
    );
    expect(migration.indexOf('continuity evidence_ids must be JSON arrays')).toBeLessThan(
      migration.indexOf('INSERT INTO "story_continuity_entry_evidence"'),
    );
  });

  it('deduplicates legacy arrays and fails missing or cross-analysis evidence explicitly', () => {
    expect(migration).toContain('SELECT DISTINCT entry."analysis_job_id"');
    expect(migration).toContain('SELECT DISTINCT issue."analysis_job_id"');
    expect(migration).toContain('ON CONFLICT ("entry_id", "evidence_id") DO NOTHING');
    expect(migration).toContain('ON CONFLICT ("issue_id", "evidence_id") DO NOTHING');
    expect(migration).toContain("RAISE EXCEPTION 'continuity evidence_ids contains cross-analysis evidence'");
    expect(migration).toContain("RAISE EXCEPTION 'continuity evidence_ids contains missing evidence'");
  });

  it('keeps failed or interrupted migration attempts atomic and backfills rerunnable', () => {
    expect(migration.startsWith('-- Candidate only.')).toBe(true);
    expect(migration).toMatch(/BEGIN; .* COMMIT;$/);
    expect(migration).toContain(
      'ON CONFLICT ("analysis_job_id", "entry_id", "path_scope", "path_key") DO NOTHING',
    );
    expect(migration).toContain('ON CONFLICT ("issue_id", "decision_revision") DO NOTHING');
  });

  it('enforces one work across manuscript, analysis, path, issue audit, and reader progress', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("work_id", "manuscript_version_id") REFERENCES "story_manuscript_versions"("work_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("work_id", "analysis_job_id", "analysis_version") REFERENCES "story_analysis_jobs"("work_id", "id", "analysis_version")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("work_id", "analysis_job_id", "entry_id") REFERENCES "story_continuity_entries"("work_id", "analysis_job_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("work_id", "analysis_job_id", "issue_id") REFERENCES "story_continuity_issues"("work_id", "analysis_job_id", "id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("work_id", "reader_progress_id") REFERENCES "story_reader_progress"("work_id", "id")',
    );
    expect(migration).toContain('ADD CONSTRAINT "story_continuity_issues_progress_fkey"');
    expect(schema).toContain('workId String @map("work_id") @db.Uuid manuscriptVersionId String');
    expect(schema).toContain('@@unique([workId, id], map: "uq_story_manuscript_versions_work_id")');
    expect(schema).toContain('@@unique([workId, id], map: "uq_story_reader_progress_work_id")');
  });

  it('separates author-original and reader-derived path state at the database boundary', () => {
    expect(migration).toContain(
      'CREATE INDEX "idx_story_continuity_path_states_work" ON "story_continuity_path_states"("work_id", "path_scope", "path_key")',
    );
    expect(migration).toContain('"path_scope" = \'author_original\'');
    expect(migration).toContain('"path_scope" = \'reader_derived\'');
    expect(migration).toContain('"reader_progress_id" IS NULL');
    expect(migration).toContain('"reader_progress_id" IS NOT NULL');
    expect(migration).toContain('"path_key" = "reader_progress_id"::text');
    expect(migration).toContain(
      'ON "story_continuity_issues"("analysis_job_id", "path_scope", "path_key", "issue_key")',
    );
    expect(migration).toContain(
      'ON "story_continuity_issues"("work_id", "path_scope", "path_key", "severity", "status")',
    );
    expect(schema).toContain(
      '@@unique([analysisJobId, pathScope, pathKey, issueKey], map: "story_continuity_issues_analysis_path_issue_key")',
    );
  });

  it('keeps decision and evidence history append-only', () => {
    expect(migration).toContain('jsonb_array_elements_text(entry."evidence_ids")');
    expect(migration).toContain('jsonb_array_elements_text(issue."evidence_ids")');
    expect(migration).toContain("'author_original', 'author_original', \"state\"");
    expect(migration).toContain('SET "decision_revision" = 1');
    expect(migration).toContain('story_continuity_decision_audits_issue_revision_key');
    expect(migration).toContain('story_continuity_entry_evidence_append_only');
    expect(migration).toContain('story_continuity_issue_evidence_append_only');
    expect(migration).toContain('story_continuity_decision_audits_append_only');
  });
});
