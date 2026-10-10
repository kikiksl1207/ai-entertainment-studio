import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');

// Only synthetic persisted records in a parent-owned, isolated PostgreSQL cluster.
// The draft rate card is a required semantic-job FK, not dispatch/config approval.
// No activation/economics/provider/company bootstrap or real author approval runs.
postgres('author approved style on owned PostgreSQL (synthetic only)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Owned loopback approved-style QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(styleValue?: Record<string, unknown>) {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      id: 'a' + randomUUID().slice(1),
      ownerUserId: owner.id, slug: `approved-style-${randomUUID()}`, status: 'draft',
      defaultLocale: 'ko', supportedLocales: ['ko'], title: { ko: 'Synthetic private work' },
      summary: { ko: 'UNRELATED_PRIVATE_WORK_NOT_RETURNED' },
    } });
    const rate = await db.storyAiRateCard.create({ data: {
      version: `approved-style-fk-${randomUUID()}`, provider: 'offline-test',
      model: 'not-dispatchable-fixture', status: 'draft',
      inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: owner.id,
    } });
    const configHash = hash({ syntheticCompletedAnalysis: true });
    async function source(version: number) {
      const structuredBody = { parts: [{ key: `synthetic-part-${version}`,
        paragraphs: [`SYNTHETIC_REFERENCE_TEXT_NOT_RETURNED_${version}`] }] };
      const manuscript = await db.storyManuscriptVersion.create({ data: {
        workId: work.id, ownerUserId: owner.id, version, locale: 'ko',
        contentHash: hash(structuredBody), structuredBody,
      } });
      const analysis = await db.storyAnalysisJob.create({ data: {
        workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1,
        idempotencyKey: randomUUID(), pipeline: SEMANTIC_PIPELINE, status: 'completed',
        actorUserId: owner.id, sourceContentHash: manuscript.contentHash, sourceLocale: manuscript.locale,
        sourceDigest: hash(structuredBody), configHash, configPins: { synthetic: true },
        rateCardId: rate.id, phase: 'completed', totalParts: 1, totalParagraphs: 1,
        plannedParagraphs: 1, completedParagraphs: 1, plannedChunks: 1, completedChunks: 1,
        completedAt: new Date(),
      } });
      return { manuscript, analysis, fingerprint: hash({
        workId: work.id, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
        analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
      }) };
    }
    const current = await source(1);
    const observations = Array.from({ length: 5 }, (_, index) => ({
      title: index === 2 ? 'Full approved middle title. '.repeat(8) + 'TITLE_TAIL' : `Rule ${index + 1}`,
      detail: index === 2
        ? 'Preserve the exact viewpoint during testimony. '.repeat(8) + 'MIDDLE_RULE_DETAIL_TAIL'
        : `Approved complete observation ${index + 1}. Do not replace dialogue with a synopsis.`,
    }));
    const categories = Array.from({ length: 7 }, (_, index) => ({
      category: `Full approved category ${index + 1}`,
      observations: [
        `Approved category rule ${index + 1}. Preserve sentence rhythm.`,
        `MIDDLE_EXCEPTION_${index + 1}: Keep viewpoint stable even during interrupted testimony.`,
        `CATEGORY_LAST_${index + 1}: Retain complete quotations and their ending punctuation.`,
      ],
    }));
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: key === 'writing_style' ? 'edited' : 'accepted',
        value: key === 'writing_style'
          ? styleValue ?? { summary: 'Full approved writing summary. '.repeat(16) + 'SUMMARY_TAIL',
            imitationBoundary: 'approved_work_only', observations, categories }
          : { summary: 'UNRELATED_PRIVATE_SECTION_NOT_RETURNED' },
        evidence: [],
      })),
    });
    const profile = await db.storyWorkGenerationProfile.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: current.manuscript.id,
      analysisJobId: current.analysis.id, sourceFingerprint: current.fingerprint,
      profileVersion: 1, reviewRevision: 1, status: 'approved',
      draftSettings: settings as unknown as Prisma.InputJsonValue,
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(current.fingerprint, settings),
      approvedByUserId: owner.id, approvedAt: new Date(),
    } });
    await db.storyMemoryRecord.create({ data: {
      workId: work.id, manuscriptVersionId: current.manuscript.id, analysisJobId: current.analysis.id,
      memoryType: 'style', memoryKey: `original-${randomUUID()}`,
      content: { ko: 'UNRELATED_MEMORY_NOT_RETURNED' }, provenance: 'writer_original', status: 'approved',
    } });
    await db.auditEvent.create({ data: {
      actorUserId: owner.id, actorType: 'system', action: 'qa_fixture_seed',
      targetType: 'story_work', targetId: work.id, metadata: { synthetic: true },
    } });
    const outerRead = jest.fn(() => { throw new Error('The read must use its transaction client'); });
    const modes: Array<{ readOnly: string; isolation: string }> = [];
    const transaction = jest.fn(async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return db.$transaction(async tx => {
        const observed = new Proxy(tx, {
          get(target, key) {
            if (key === '$executeRaw') return async (sql: Prisma.Sql) => {
              expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY');
              expect(sql.values).toEqual([]);
              const result = await target.$executeRaw(sql);
              const readOnly = await target.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
              const isolation = await target.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`;
              modes.push({ readOnly: readOnly[0].transaction_read_only, isolation: isolation[0].transaction_isolation });
              return result;
            };
            return Reflect.get(target, key);
          },
        });
        return callback(observed);
      }, options);
    });
    const service = new StoryGenerationProfileService({
      $transaction: transaction, storyWork: { findFirst: outerRead },
      storyManuscriptVersion: { findFirst: outerRead }, storyAnalysisJob: { findFirst: outerRead },
      storyWorkGenerationProfile: { findFirst: outerRead },
    } as never);
    const forbiddenEntrypoints = ['getOrCreate', 'autoApproveCompany', 'approve', 'update',
      'createDraftAtCompletion', 'onApplicationBootstrap'] as const;
    const spies = forbiddenEntrypoints.map(name => jest.spyOn(service, name));
    return { owner, work, rate, current, source, profile, settings, service, modes, transaction, outerRead, spies };
  }

  // Full rows, including timestamps and JSON: reads must not rewrite approval,
  // memory or audit. This is bounded to affected source/approval tables, not all schema.
  async function snapshot() {
    return {
      users: await db.user.findMany({ orderBy: { id: 'asc' } }),
      works: await db.storyWork.findMany({ orderBy: { id: 'asc' } }),
      manuscripts: await db.storyManuscriptVersion.findMany({ orderBy: { id: 'asc' } }),
      analyses: await db.storyAnalysisJob.findMany({ orderBy: { id: 'asc' } }),
      rates: await db.storyAiRateCard.findMany({ orderBy: { id: 'asc' } }),
      profiles: await db.storyWorkGenerationProfile.findMany({ orderBy: { id: 'asc' } }),
      memories: await db.storyMemoryRecord.findMany({ orderBy: { id: 'asc' } }),
      audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  function assertReadOnly(f: Awaited<ReturnType<typeof fixture>>) {
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.modes).toEqual([{ readOnly: 'on', isolation: 'repeatable read' }]);
    expect(f.outerRead).not.toHaveBeenCalled();
    for (const spy of f.spies) expect(spy).not.toHaveBeenCalled();
  }

  it('AUTHOR-APPROVED-STYLE-PG: preserves all five approved observations, seven categories and middle/tails without writes', async () => {
    const f = await fixture(), before = await snapshot();
    const result = await f.service.readCurrentApprovedStyle(f.owner.id, f.work.id);
    const expected = f.settings.sections.find(section => section.key === 'writing_style')!;
    expect(result).toEqual({
      version: 'story-author-approved-style-v1', sourceScope: 'latest_private_manuscript_completed_analysis',
      locale: 'ko', manuscriptVersion: 1, analysisVersion: 1, profileVersion: 1, reviewRevision: 1,
      section: expected, readOnly: true, providerCalls: 0, operatingWrites: 0,
      bodySourceAligned: false, semanticQualityVerified: false,
    });
    const observations = result.section.value.observations as Array<{ title: string; detail: string }>;
    const categories = result.section.value.categories as Array<{ category: string; observations: string[] }>;
    expect(observations).toHaveLength(5); expect(categories).toHaveLength(7);
    expect(observations[2].title.length).toBeGreaterThan(160);
    expect(observations[2].detail.length).toBeGreaterThan(160);
    expect(observations[2].title.endsWith('TITLE_TAIL')).toBe(true);
    expect(observations[2].detail.endsWith('MIDDLE_RULE_DETAIL_TAIL')).toBe(true);
    expect(categories[6].observations).toHaveLength(3);
    expect(categories[6].observations[1]).toContain('MIDDLE_EXCEPTION_7');
    expect(categories[6].observations[2]).toContain('CATEGORY_LAST_7');
    expect(JSON.stringify(result)).not.toMatch(/UNRELATED_|SYNTHETIC_REFERENCE_TEXT|approvedFingerprint|sourceFingerprint/);
    expect(await snapshot()).toEqual(before);
    assertReadOnly(f);
  });

  it('AUTHOR-APPROVED-STYLE-PG-F1-F2: uppercase UUID reads a summary-only approval without invented optional fields', async () => {
    const value = { summary: 'Existing complete summary-only approved style' };
    const f = await fixture(value), before = await snapshot(), fingerprint = f.profile.approvedFingerprint;
    const uppercase = f.work.id.toUpperCase();
    expect(uppercase).not.toBe(f.work.id);
    const result = await f.service.readCurrentApprovedStyle(f.owner.id, uppercase);
    expect(result.section.value).toEqual(value);
    expect(result.section.value).not.toHaveProperty('observations');
    expect(result.section.value).not.toHaveProperty('categories');
    expect(result.section.value).not.toHaveProperty('imitationBoundary');
    expect(result.bodySourceAligned).toBe(false);
    expect((await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } }))
      .approvedFingerprint).toBe(fingerprint);
    expect(await snapshot()).toEqual(before);
    assertReadOnly(f);
  });

  it('AUTHOR-APPROVED-STYLE-PG-F1: preserves lawful custom keys and generic rows under the stored approval without writes', async () => {
    const value = { summary: 12, customRule: { enabled: false, tail: 'Complete approved custom rule tail' },
      observations: [null, 'Complete observation tail', { detail: 12, extra: ['Full nested row tail'] }],
      categories: { ordered: ['Complete category tail', false] }, imitationBoundary: '' };
    const f = await fixture(value), before = await snapshot(), fingerprint = f.profile.approvedFingerprint;
    const result = await f.service.readCurrentApprovedStyle(f.owner.id, f.work.id);
    const expected = f.settings.sections.find(section => section.key === 'writing_style')!;
    expect(result.section).toEqual(expected);
    expect(stableJson(result.section)).toBe(stableJson(expected));
    expect(result.section.value).toEqual(value);
    expect(result).toMatchObject({ readOnly: true, operatingWrites: 0, providerCalls: 0,
      bodySourceAligned: false, semanticQualityVerified: false });
    const stored = await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } });
    expect(stored.approvedSettings).toEqual(f.settings);
    expect(stored.approvedFingerprint).toBe(fingerprint);
    expect(creatorGenerationProfileFingerprint(f.current.fingerprint,
      normalizeCreatorGenerationProfile('story', stored.approvedSettings))).toBe(fingerprint);
    expect(await snapshot()).toEqual(before);
    assertReadOnly(f);
  });

  it('AUTHOR-APPROVED-STYLE-PG: latest current needs-review profile rejects instead of reusing the older approval', async () => {
    const f = await fixture();
    const latest = await f.source(2);
    const needsReview = await db.storyWorkGenerationProfile.create({ data: {
      workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: latest.manuscript.id,
      analysisJobId: latest.analysis.id, sourceFingerprint: latest.fingerprint,
      profileVersion: 2, reviewRevision: 0, status: 'needs_review',
      draftSettings: f.settings as unknown as Prisma.InputJsonValue,
    } });
    const before = await snapshot();
    let error: unknown;
    try { await f.service.readCurrentApprovedStyle(f.owner.id, f.work.id); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({
      status: 409, response: { code: 'GENERATION_PROFILE_APPROVED_STYLE_REQUIRED' },
    });
    await expect(db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } }))
      .resolves.toMatchObject({ status: 'approved', approvedFingerprint: f.profile.approvedFingerprint });
    await expect(db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: needsReview.id } }))
      .resolves.toMatchObject({ status: 'needs_review', approvedSettings: null, approvedFingerprint: null });
    expect(await snapshot()).toEqual(before);
    assertReadOnly(f);
  });
});
