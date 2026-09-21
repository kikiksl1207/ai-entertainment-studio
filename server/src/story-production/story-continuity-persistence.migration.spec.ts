import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260921170000_story_continuity_persistence_guard/migration.sql',
  ),
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

  it('separates author-original and reader-derived path state at the database boundary', () => {
    expect(migration).toContain(
      'CREATE INDEX "idx_story_continuity_path_states_work" ON "story_continuity_path_states"("work_id", "path_scope", "path_key")',
    );
    expect(migration).toContain('"path_scope" = \'author_original\'');
    expect(migration).toContain('"path_scope" = \'reader_derived\'');
    expect(migration).toContain('"reader_progress_id" IS NULL');
    expect(migration).toContain('"reader_progress_id" IS NOT NULL');
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
