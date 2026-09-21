import { spawnSync } from 'child_process';

const databaseUrl = process.env.STORY_TEST_DATABASE_URL;
const psqlPath = process.env.STORY_PSQL_PATH ?? 'psql';
const describePostgres = databaseUrl ? describe : describe.skip;

function runSql(sql: string) {
  return spawnSync(
    psqlPath,
    [
      `--dbname=${databaseUrl}`,
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8' },
  );
}

function expectSqlPass(sql: string) {
  const result = runSql(sql);
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  return result.stdout.trim();
}

function expectSqlReject(sql: string, evidence: RegExp) {
  const result = runSql(sql);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(evidence);
}

const canonicalColumns = `
  id,reuse_key,work_id,release_id,release_checksum,manuscript_version_id,
  source_kind,source_canonical_part_id,source_canonical_scene_id,source_canonical_choice_id,
  source_fingerprint,semantic_path_fingerprint,context_fingerprint,
  prompt_version,output_schema_version,locale,provider,model,rate_card_version,
  cost_policy_version,rights_activation_key,moderation_policy_version,
  moderation_evidence_version,quality_policy_version,claim_token,status`;

const canonicalSnapshot = `
  'canonical','30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
  'source','path','context','prompt','schema','ko','test','model','rate','cost',
  'rights','moderation-policy','moderation-evidence','quality','claim'`;

describePostgres('shared story result PostgreSQL ownership and lifecycle', () => {
  beforeAll(() => {
    const seeded = expectSqlPass(`
      SET session_replication_role = replica;
      DELETE FROM story_ai_reusable_choices
      WHERE shared_result_id::text LIKE '70000000-0000-0000-0000-%';
      DELETE FROM story_ai_reusable_beats
      WHERE shared_result_id::text LIKE '70000000-0000-0000-0000-%';
      DELETE FROM story_ai_reusable_results
      WHERE id::text LIKE '70000000-0000-0000-0000-%';
      DELETE FROM story_releases WHERE id::text LIKE '20000000-0000-0000-0000-%';
      DELETE FROM story_manuscript_versions WHERE id::text LIKE '60000000-0000-0000-0000-%';
      DELETE FROM story_choices WHERE id::text LIKE '50000000-0000-0000-0000-%';
      DELETE FROM story_scenes WHERE id::text LIKE '40000000-0000-0000-0000-%';
      DELETE FROM story_parts WHERE id::text LIKE '30000000-0000-0000-0000-%';
      DELETE FROM story_works WHERE id::text LIKE '10000000-0000-0000-0000-%';
      INSERT INTO story_works (id,owner_user_id,slug,title,summary)
      VALUES
        ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','shared-qa-work-1','{}','{}'),
        ('10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002','shared-qa-work-2','{}','{}');
      INSERT INTO story_parts (id,work_id,position,title)
      VALUES
        ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,'{}'),
        ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',1,'{}');
      INSERT INTO story_scenes (id,part_id,scene_key,position,title)
      VALUES
        ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','scene-1',1,'{}'),
        ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','scene-2',1,'{}');
      INSERT INTO story_choices (id,scene_id,choice_key,position,label)
      VALUES
        ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','choice-1',1,'{}'),
        ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','choice-2',1,'{}');
      INSERT INTO story_manuscript_versions
        (id,work_id,owner_user_id,version,locale,content_hash,structured_body)
      VALUES
        ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',1,'ko','hash-1','{}'),
        ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002',1,'ko','hash-2','{}');
      INSERT INTO story_releases
        (id,work_id,version,manuscript_version_id,branch_graph_snapshot,ending_set_snapshot,
         scene_asset_manifest,localized_display_snapshot,checksum,created_by_user_id)
      VALUES
        ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,'60000000-0000-0000-0000-000000000001','{}','{}','{}','{}','release-1','90000000-0000-0000-0000-000000000001'),
        ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',1,'60000000-0000-0000-0000-000000000002','{}','{}','{}','{}','release-2','90000000-0000-0000-0000-000000000002');
      SET session_replication_role = DEFAULT;

      INSERT INTO story_ai_reusable_results (${canonicalColumns}) VALUES (
        '70000000-0000-0000-0000-000000000001','valid-source',
        '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'release-1','60000000-0000-0000-0000-000000000001',${canonicalSnapshot},'pending');
      INSERT INTO story_ai_reusable_beats (shared_result_id,position,beat_type,content)
      VALUES ('70000000-0000-0000-0000-000000000001',1,'paragraph','{}');
      INSERT INTO story_ai_reusable_choices (shared_result_id,position,choice_key,label)
      VALUES ('70000000-0000-0000-0000-000000000001',1,'shared-next','{}');
      UPDATE story_ai_reusable_results
      SET status='approved',claim_token=NULL,result_checksum='result',title='{}',
          visual_manifest='{}',approved_at=CURRENT_TIMESTAMP
      WHERE id='70000000-0000-0000-0000-000000000001';
    `);
    expect(seeded).toBe('');
  });

  it('installs all composite owner constraints', () => {
    const count = expectSqlPass(`
      SELECT count(*) FROM pg_constraint WHERE conname IN (
        'story_ai_reusable_results_part_work_fk',
        'story_ai_reusable_results_scene_part_fk',
        'story_ai_reusable_results_source_choice_fk',
        'story_ai_reusable_results_source_shared_owner_fk',
        'story_ai_reusable_results_source_shared_choice_fk'
      );
    `);
    expect(count).toBe('5');
  });

  it('rejects a work-2 canonical row that points at work-1 part, scene and choice', () => {
    expectSqlReject(`
      INSERT INTO story_ai_reusable_results (${canonicalColumns}) VALUES (
        '70000000-0000-0000-0000-000000000002','cross-work-canonical',
        '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
        'release-2','60000000-0000-0000-0000-000000000002',${canonicalSnapshot},'pending');
    `, /story_ai_reusable_results_part_work_fk/);
  });

  it('rejects a work-2 generated row that points at a work-1 shared result', () => {
    expectSqlReject(`
      INSERT INTO story_ai_reusable_results (
        id,reuse_key,work_id,release_id,release_checksum,manuscript_version_id,
        source_kind,source_shared_result_id,source_shared_choice_key,
        source_fingerprint,semantic_path_fingerprint,context_fingerprint,
        prompt_version,output_schema_version,locale,provider,model,rate_card_version,
        cost_policy_version,rights_activation_key,moderation_policy_version,
        moderation_evidence_version,quality_policy_version,claim_token,status
      ) VALUES (
        '70000000-0000-0000-0000-000000000003','cross-work-shared',
        '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
        'release-2','60000000-0000-0000-0000-000000000002','generated',
        '70000000-0000-0000-0000-000000000001','shared-next',
        'source','path','context','prompt','schema','ko','test','model','rate','cost',
        'rights','moderation-policy','moderation-evidence','quality','claim','pending');
    `, /generated reusable result requires an approved shared source|source_shared_owner_fk/);
  });

  it('rejects a generated row whose shared choice key does not exist', () => {
    expectSqlReject(`
      INSERT INTO story_ai_reusable_results (
        id,reuse_key,work_id,release_id,release_checksum,manuscript_version_id,
        source_kind,source_shared_result_id,source_shared_choice_key,
        source_fingerprint,semantic_path_fingerprint,context_fingerprint,
        prompt_version,output_schema_version,locale,provider,model,rate_card_version,
        cost_policy_version,rights_activation_key,moderation_policy_version,
        moderation_evidence_version,quality_policy_version,claim_token,status
      ) VALUES (
        '70000000-0000-0000-0000-000000000004','missing-shared-choice',
        '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'release-1','60000000-0000-0000-0000-000000000001','generated',
        '70000000-0000-0000-0000-000000000001','missing-choice',
        'source','path','context','prompt','schema','ko','test','model','rate','cost',
        'rights','moderation-policy','moderation-evidence','quality','claim','pending');
    `, /generated reusable result requires an approved shared source|source_shared_choice_fk/);
  });

  it('accepts an exact same-work, same-release shared source and choice', () => {
    expectSqlPass(`
      INSERT INTO story_ai_reusable_results (
        id,reuse_key,work_id,release_id,release_checksum,manuscript_version_id,
        source_kind,source_shared_result_id,source_shared_choice_key,
        source_fingerprint,semantic_path_fingerprint,context_fingerprint,
        prompt_version,output_schema_version,locale,provider,model,rate_card_version,
        cost_policy_version,rights_activation_key,moderation_policy_version,
        moderation_evidence_version,quality_policy_version,claim_token,status
      ) VALUES (
        '70000000-0000-0000-0000-000000000005','valid-shared-child',
        '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'release-1','60000000-0000-0000-0000-000000000001','generated',
        '70000000-0000-0000-0000-000000000001','shared-next',
        'source-child','path-child','context-child','prompt','schema','ko','test','model','rate','cost',
        'rights','moderation-policy','moderation-evidence','quality','claim-child','pending');
    `);
  });

  it.each(['approved', 'revoked'])('rejects direct %s INSERT', (status) => {
    expectSqlReject(`
      INSERT INTO story_ai_reusable_results (${canonicalColumns},result_checksum,title,visual_manifest,approved_at,revoked_at,revoke_reason)
      VALUES (
        gen_random_uuid(),'direct-${status}-${Date.now()}',
        '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'release-1','60000000-0000-0000-0000-000000000001',${canonicalSnapshot},'${status}',
        ${status === 'approved' ? "'result','{}','{}',CURRENT_TIMESTAMP,NULL,NULL" : "NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,'rejected'"});
    `, /story AI reusable result must be inserted as pending/);
  });

  it('rejects rewriting approved_at after pending becomes approved', () => {
    expectSqlReject(`
      UPDATE story_ai_reusable_results
      SET approved_at = approved_at + INTERVAL '1 second'
      WHERE id = '70000000-0000-0000-0000-000000000001'
        AND status = 'approved';
    `, /story AI reusable result approval timestamp is immutable/);
  });
});
