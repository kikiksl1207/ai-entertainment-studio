import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const PRIVATE = 'SYNTHETIC_ORIGINAL_REFERENCE_PRIVATE_METADATA';
const EXCLUDED = 'SYNTHETIC_EXCLUDED_SOURCE';
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const WORDS = {
  ko: '\ud569\uc131 \uc6d0\uc791 \ubb38\uc7a5',
  en: 'Synthetic original paragraph',
  ja: '\u5408\u6210\u539f\u4f5c\u306e\u6587',
  'zh-Hans': '\u5408\u6210\u539f\u4f5c\u53e5\u5b50',
  'zh-Hant': '\u5408\u6210\u539f\u4f5c\u8a9e\u53e5',
};
const text = (marker: string, repetitions = 1): Record<string, string> => Object.fromEntries(
  LOCALES.map(locale => [locale, marker + ' ' + WORDS[locale].repeat(repetitions) + '\n<literal>& TAIL']),
);
jest.setTimeout(30000);

// Stored generated rows are seeded metadata, not provider output or economic settlement.
// Draft rate/denied consent are FK fixtures only; no approval, grant or activation is performed.
postgres('author original reference on owned PostgreSQL (synthetic only)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Owned loopback original-reference QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(beforeWorkRead?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const owner = await db.user.create({ data: {} });
    const other = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      id: 'a' + randomUUID().slice(1), ownerUserId: owner.id,
      slug: 'original-reference-' + randomUUID(), title: text('Work'), summary: {},
      defaultLocale: 'ko', supportedLocales: [...LOCALES], status: 'draft',
    } });
    const structuredBody = { parts: [{ paragraphs: [PRIVATE] }] };
    const manuscript = await db.storyManuscriptVersion.create({ data: {
      workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko',
      contentHash: hash(structuredBody), structuredBody,
    } });
    const rate = await db.storyAiRateCard.create({ data: {
      version: 'original-reference-fk-' + randomUUID(), status: 'draft', provider: 'offline-test',
      model: 'not-dispatchable-fixture', inputCostPerMillion: 0, outputCostPerMillion: 0,
      createdByUserId: owner.id,
    } });
    const analysis = await db.storyAnalysisJob.create({ data: {
      workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1, idempotencyKey: randomUUID(),
      pipeline: SEMANTIC_PIPELINE, status: 'completed', actorUserId: owner.id,
      sourceContentHash: manuscript.contentHash, sourceLocale: 'ko', sourceDigest: manuscript.contentHash,
      configHash: hash({ synthetic: true }), configPins: { private: PRIVATE },
      rateCardId: rate.id, phase: 'completed', completedAt: new Date(),
    } });
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: 'accepted', evidence: [], value: { summary: PRIVATE },
      })),
    });
    await db.storyWorkGenerationProfile.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id, analysisJobId: analysis.id,
      sourceFingerprint: hash({ manuscript: manuscript.id, analysis: analysis.id }),
      profileVersion: 1, reviewRevision: 0, status: 'needs_review',
      draftSettings: settings as unknown as Prisma.InputJsonValue,
    } });
    await db.storyMemoryRecord.create({ data: {
      workId: work.id, manuscriptVersionId: manuscript.id, analysisJobId: analysis.id,
      memoryType: 'style', memoryKey: 'original-reference-' + randomUUID(),
      content: { ko: PRIVATE }, provenance: 'writer_original', status: 'approved',
    } });
    await db.auditEvent.create({ data: {
      actorUserId: owner.id, actorType: 'system', action: 'qa_fixture_seed',
      targetType: 'story_work', targetId: work.id, metadata: { synthetic: true, private: PRIVATE },
    } });
    const part = await db.storyPart.create({ data: {
      workId: work.id, position: 1, title: text('Part'), status: 'published',
    } });
    const otherPart = await db.storyPart.create({ data: {
      workId: work.id, position: 2, title: text('Other part'), status: 'published',
    } });
    const otherWork = await db.storyWork.create({ data: {
      ownerUserId: other.id, slug: 'excluded-original-' + randomUUID(), title: text(EXCLUDED), summary: {},
    } });
    const foreignPart = await db.storyPart.create({ data: {
      workId: otherWork.id, position: 1, title: {}, status: 'published',
    } });
    const sourceScenes: Array<{
      id: string; position: number; title: Record<string, string>;
      beats: Array<{ position: number; type: string; content: Record<string, string> }>;
    }> = [];
    // Insert backwards; UUID order also opposes scene order. Gaps exceed row-count bounds legally.
    for (const row of [{ position: 2500, prefix: '1' }, { position: 101, prefix: '8' }, { position: 2, prefix: 'f' }]) {
      const title = text('Scene ' + row.position, 20);
      const scene = await db.storyScene.create({ data: {
        id: row.prefix + randomUUID().slice(1), partId: part.id,
        sceneKey: 'original-' + row.position, position: row.position, title, status: 'published',
      } });
      const beats = [
        { position: row.position === 2 ? 1 : 1001, type: 'paragraph', content: text('Full ' + row.position, 300) },
        { position: row.position === 2 ? 3 : 2005, type: 'scene_break', content: text('Break ' + row.position) },
      ];
      for (const beat of [...beats].reverse()) await db.storyBeat.create({ data: {
        sceneId: scene.id, position: beat.position, beatType: beat.type, content: beat.content,
      } });
      sourceScenes.push({ id: scene.id, position: scene.position, title, beats });
    }
    sourceScenes.sort((a, b) => a.position - b.position);
    const canonical = sourceScenes[0];
    for (const excluded of [
      { partId: part.id, status: 'draft', fixtureSource: false, position: 1 },
      { partId: part.id, status: 'published', fixtureSource: true, position: 4 },
      { partId: otherPart.id, status: 'published', fixtureSource: false, position: 1 },
      { partId: foreignPart.id, status: 'published', fixtureSource: false, position: 1 },
    ]) {
      const scene = await db.storyScene.create({ data: {
        ...excluded, sceneKey: 'excluded-' + randomUUID(), title: text(EXCLUDED),
      } });
      await db.storyBeat.create({ data: {
        sceneId: scene.id, position: 1, beatType: 'paragraph', content: text(EXCLUDED),
      } });
    }
    const release = await db.storyRelease.create({ data: {
      workId: work.id, version: 1, status: 'active', manuscriptVersionId: manuscript.id,
      checksum: hash({ syntheticRelease: work.id }), branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: owner.id,
    } });
    await db.storyWork.update({ where: { id: work.id }, data: {
      status: 'published', activeReleaseId: release.id, publishedVersion: release.version,
    } });
    const progress = await db.storyReaderProgress.create({ data: {
      userId: owner.id, workId: work.id, currentSceneId: canonical.id, activeReleaseId: release.id,
      storyVersion: release.version, progressRevision: 7,
    } });
    const consent = await db.storyStyleProfileConsent.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id,
      rightsConfirmed: false, aiBranchAllowed: false, startsAt: new Date(0),
    } });
    const choice = await db.storyCustomChoice.create({ data: {
      userId: owner.id, workId: work.id, progressId: progress.id, sceneId: canonical.id,
      idempotencyKey: randomUUID(), privateInput: PRIVATE, contentHash: hash(PRIVATE), moderationDecision: 'allow',
    } });
    const origin = await db.storyAiContinuation.create({ data: {
      userId: owner.id, workId: work.id, releaseId: release.id, progressId: progress.id,
      requestKind: 'custom_choice', customChoiceId: choice.id, rateCardId: rate.id,
      styleConsentId: consent.id, capabilityRevision: 1, idempotencyKey: randomUUID(),
      sourcePartId: part.id, sourceSceneId: canonical.id, sourceProgressRevision: progress.progressRevision,
      manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, analysisVersion: 1,
      status: 'completed', completedAt: new Date(), contextReferences: { privateContext: PRIVATE },
      estimatedCostKrw: 0, hardBudgetKrw: 0, inputTokenLimit: 32768, outputTokenLimit: 8192,
    } });
    const savedTitle = text('Stored generated title', 20);
    const savedBeats = [
      { position: 1, type: 'paragraph', content: text('Stored full body', 300) },
      { position: 3, type: 'scene_break', content: text('Stored scene break') },
    ];
    const generated = await db.storyAiGeneratedScene.create({ data: {
      continuationId: origin.id, userId: owner.id, workId: work.id, releaseId: release.id,
      progressId: progress.id, sourcePartId: part.id, sceneKey: 'synthetic-stored-body',
      resultChecksum: hash({ syntheticBody: origin.id }), title: savedTitle, visualManifest: {},
    } });
    for (const beat of [...savedBeats].reverse()) await db.storyAiGeneratedBeat.create({ data: {
      sceneId: generated.id, position: beat.position, beatType: beat.type, content: beat.content,
    } });
    await db.storyAiGeneratedChoice.create({ data: {
      sceneId: generated.id, choiceKey: 'synthetic-next', position: 1,
      label: text(PRIVATE), routeKind: 'generation_required',
    } });
    await db.storyAiContinuation.update({ where: { id: origin.id }, data: { resultGeneratedSceneId: generated.id } });
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: {
      currentSceneId: null, currentGeneratedSceneId: generated.id,
    } });

    const modes: Array<{ readOnly: string; isolation: string }> = [];
    const reads: Array<{ model: string; method: string; query: unknown }> = [];
    const forbidden = jest.fn(() => { throw new Error('Outer access, non-body read or write prohibited'); });
    const bodyModels = new Set(['storyWork', 'storyReaderProgress', 'storyRelease', 'storyPart',
      'storyScene', 'storyBeat', 'storyChoice', 'storyAiContinuation', 'storyAiGeneratedScene',
      'storyAiGeneratedBeat', 'storyAiGeneratedChoice']);
    const readMethods = new Set(['findFirst', 'findUnique', 'findMany']);
    const transaction = jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel }) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return db.$transaction(async tx => {
        let readOnly = false;
        const observed = new Proxy(tx, {
          get(target, key) {
            if (key === '$executeRaw') return async (sql: Prisma.Sql) => {
              expect(readOnly).toBe(false);
              expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); expect(sql.values).toEqual([]);
              const result = await target.$executeRaw(sql);
              readOnly = true;
              const mode = await target.$queryRaw<Array<{ transaction_read_only: string }>>(Prisma.raw('SHOW transaction_read_only'));
              const isolation = await target.$queryRaw<Array<{ transaction_isolation: string }>>(Prisma.raw('SHOW transaction_isolation'));
              modes.push({ readOnly: mode[0].transaction_read_only, isolation: isolation[0].transaction_isolation });
              return result;
            };
            if (typeof key !== 'string' || !bodyModels.has(key)) return forbidden;
            const delegate = Reflect.get(target, key);
            return new Proxy(delegate, {
              get(model, method) {
                if (typeof method !== 'string' || !readMethods.has(method)) return forbidden;
                const actual = Reflect.get(model, method);
                return (...args: unknown[]) => {
                  expect(readOnly).toBe(true);
                  reads.push({ model: key, method, query: args[0] });
                  if (key === 'storyWork' && method === 'findFirst' && beforeWorkRead) {
                    const probe = beforeWorkRead;
                    beforeWorkRead = undefined;
                    return (async () => { await probe(target); return actual.apply(model, args); })();
                  }
                  return actual.apply(model, args);
                };
              },
            });
          },
        });
        return callback(observed);
      }, options);
    });
    const service = new StoryAuthorBodyPreviewService(new Proxy({ $transaction: transaction }, {
      get(target, key) { return key === '$transaction' ? target.$transaction : new Proxy({}, { get: () => forbidden }); },
    }) as never);
    return { owner, other, work, part, release, progress, origin, generated, canonical,
      sourceScenes, savedTitle, savedBeats, service, modes, reads, transaction, forbidden,
      clearWorkReadProbe: () => { beforeWorkRead = undefined; } };
  }

  // Full ordered rows stay in memory only. JSON invokes Date/Decimal.toJSON before comparison;
  // no stableJson/hash sees those objects. Failed assertions never print the row snapshots.
  async function snapshot() {
    const names = ['user', 'storyWork', 'storyManuscriptVersion', 'storyAnalysisJob', 'storyAiRateCard',
      'storyWorkGenerationProfile', 'storyMemoryRecord', 'auditEvent', 'storyPart', 'storyScene', 'storyBeat',
      'storyChoice', 'storyRelease', 'storyReaderProgress', 'storyStyleProfileConsent', 'storyCustomChoice',
      'storyAiContinuation', 'storyAiGeneratedScene', 'storyAiGeneratedBeat', 'storyAiGeneratedChoice',
      'storyAiUsageLedger', 'storyAiAllowanceBucket', 'storyAuthorBodyTrialApproval',
      'walletAccount', 'walletLedger', 'userEntitlement'] as const;
    const rows: Record<string, unknown> = {};
    for (const name of names) rows[name] = await (db[name] as any).findMany({ orderBy: { id: 'asc' } });
    return JSON.stringify(rows);
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Result = Awaited<ReturnType<StoryAuthorBodyPreviewService['originalReference']>>;
  async function checked(f: Fixture, action: () => Promise<Result>) {
    const before = await snapshot(), calls = f.transaction.mock.calls.length;
    try { return await action(); }
    finally {
      expect((await snapshot()) === before).toBe(true);
      expect(f.transaction).toHaveBeenCalledTimes(calls + 1);
      expect(f.modes).toHaveLength(f.transaction.mock.calls.length);
      expect(f.modes[f.modes.length - 1]).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
      expect(f.forbidden).not.toHaveBeenCalled();
    }
  }
  async function rejects(f: Fixture, userId: string, status: number, code: string, locale = 'ko') {
    try {
      await checked(f, () => f.service.originalReference(userId, f.work.id, { locale }));
      throw new Error('Expected safe original-reference rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(status === 404 ? NotFoundException : ConflictException);
      expect((error as ConflictException).getStatus()).toBe(status);
      expect((error as ConflictException).getResponse()).toEqual({ code });
    }
  }
  function original(f: Fixture, locale: typeof LOCALES[number]) {
    return { scenes: f.sourceScenes.map(scene => ({
      position: scene.position, title: scene.title[locale],
      beats: scene.beats.map(beat => ({ position: beat.position, type: beat.type, content: beat.content[locale] })),
    })) };
  }
  function safe(result: Result, workId: string, locale: typeof LOCALES[number]) {
    expect(Object.keys(result).sort()).toEqual(['contract', 'workId', 'locale', 'readOnly', 'referenceScope',
      'progressRevision', 'semanticQualityVerified', 'bodySourceAligned', 'dispatchAuthorized',
      'providerCalls', 'operatingWrites', 'outcome', 'original', 'savedBody'].sort());
    expect(result).toMatchObject({
      contract: 'story-author-body-original-reference-v1', workId, locale,
      readOnly: true, referenceScope: 'current_published_original_part', progressRevision: 7,
      semanticQualityVerified: false, bodySourceAligned: false, dispatchAuthorized: false,
      providerCalls: 0, operatingWrites: 0,
    });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain(PRIVATE); expect(wire).not.toContain(EXCLUDED);
    expect(wire).not.toMatch(/"(?:id|userId|sceneId|partId|releaseId|progressId|contextReferences|choices|fingerprint|hash)"/);
    expect(wire.replace(workId, '')).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\b[a-f0-9]{64}\b/i);
    expect(Buffer.byteLength(wire, 'utf8')).toBeLessThanOrEqual(256 * 1024);
  }

  it('AUTHOR-ORIGINAL-REFERENCE-PG: five locales read full ordered original and stored body with exact source exclusion and no writes', async () => {
    const f = await fixture();
    for (const locale of LOCALES) {
      const start = f.reads.length;
      const result = await checked(f, () => f.service.originalReference(f.owner.id.toUpperCase(), f.work.id.toUpperCase(), { locale }));
      safe(result, f.work.id, locale);
      expect(result.outcome).toBe('reference_ready');
      expect(result.original).toEqual(original(f, locale));
      expect(result.savedBody).toEqual({
        isGenerated: true, title: f.savedTitle[locale],
        beats: f.savedBeats.map(beat => ({ position: beat.position, type: beat.type, content: beat.content[locale] })),
      });
      const reads = f.reads.slice(start);
      expect(reads.filter(row => row.model === 'storyScene')).toEqual([{
        model: 'storyScene', method: 'findMany', query: {
          where: { partId: f.part.id, status: 'published', fixtureSource: false },
          orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 101,
          select: { id: true, position: true, title: true },
        },
      }]);
      expect(reads.filter(row => row.model === 'storyBeat')).toEqual([{
        model: 'storyBeat', method: 'findMany', query: {
          where: { sceneId: { in: f.sourceScenes.map(scene => scene.id) } },
          orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }], take: 1001,
          select: { id: true, position: true, beatType: true, content: true, sceneId: true },
        },
      }]);
      expect(reads.find(row => row.model === 'storyAiContinuation')?.query).toEqual({
        where: { id: f.origin.id, userId: f.owner.id, workId: f.work.id, progressId: f.progress.id,
          releaseId: f.release.id, status: 'completed', resultGeneratedSceneId: f.generated.id },
        select: { id: true },
      });
    }
    expect(f.transaction).toHaveBeenCalledTimes(5);
  });

  it('AUTHOR-ORIGINAL-REFERENCE-PG: canonical body remains readable; absent saved body has no original query and still checks owner', async () => {
    const f = await fixture();
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: {
      currentSceneId: f.canonical.id, currentGeneratedSceneId: null,
    } });
    const canonical = await checked(f, () => f.service.originalReference(f.owner.id, f.work.id, { locale: 'ko' }));
    safe(canonical, f.work.id, 'ko');
    expect(canonical.outcome).toBe('reference_ready');
    expect(canonical.original).toEqual(original(f, 'ko'));
    expect(canonical.savedBody).toEqual({
      isGenerated: false, title: f.canonical.title.ko,
      beats: f.canonical.beats.map(beat => ({ position: beat.position, type: beat.type, content: beat.content.ko })),
    });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { currentSceneId: null } });
    const start = f.reads.length;
    const absent = await checked(f, () => f.service.originalReference(f.owner.id, f.work.id, { locale: 'ko' }));
    safe(absent, f.work.id, 'ko');
    expect(absent).toMatchObject({ outcome: 'no_saved_body', original: null, savedBody: null });
    expect(f.reads.slice(start).map(row => row.model)).toEqual(['storyWork', 'storyReaderProgress', 'storyRelease']);
    const nonownerStart = f.reads.length;
    await rejects(f, f.other.id, 404, 'STORY_AUTHOR_BODY_PREVIEW_UNAVAILABLE');
    expect(f.reads.slice(nonownerStart).map(row => row.model)).toEqual(['storyWork']);
  });

  it('AUTHOR-ORIGINAL-REFERENCE-PG: obsolete release, incomplete origin and invalid original fail closed without fallback or mutations', async () => {
    const f = await fixture();
    const replacement = await db.storyRelease.create({ data: {
      workId: f.work.id, version: 2, status: 'candidate',
      manuscriptVersionId: f.origin.manuscriptVersionId!, checksum: hash({ syntheticReplacement: f.work.id }),
      branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, createdByUserId: f.owner.id,
    } });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { activeReleaseId: replacement.id } });
    const staleStart = f.reads.length;
    await rejects(f, f.owner.id, 409, 'STORY_AUTHOR_BODY_PREVIEW_CHANGED');
    expect(f.reads.slice(staleStart).map(row => row.model)).toEqual(['storyWork', 'storyReaderProgress']);
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { activeReleaseId: f.release.id } });
    await db.storyAiContinuation.update({ where: { id: f.origin.id }, data: { status: 'failed' } });
    const originStart = f.reads.length;
    await rejects(f, f.owner.id, 409, 'STORY_AUTHOR_BODY_PREVIEW_CHANGED');
    expect(f.reads.slice(originStart).some(row => row.model === 'storyBeat' || row.model === 'storyAiGeneratedBeat')).toBe(false);
    await db.storyAiContinuation.update({ where: { id: f.origin.id }, data: { status: 'completed' } });
    const middle = f.sourceScenes[1];
    await db.storyScene.update({ where: { id: middle.id }, data: { title: { ko: middle.title.ko } } });
    await rejects(f, f.owner.id, 409, 'STORY_AUTHOR_BODY_PREVIEW_TRANSLATION_UNAVAILABLE', 'en');
    await db.storyScene.update({ where: { id: middle.id }, data: {
      title: middle.title, position: f.canonical.position,
    } });
    await rejects(f, f.owner.id, 409, 'STORY_AUTHOR_BODY_PREVIEW_CHANGED');
  });

  it('AUTHOR-ORIGINAL-REFERENCE-PG: PostgreSQL enforces READ ONLY with SQLSTATE 25006 and rolls back without row changes', async () => {
    let workId: string;
    const attemptWrite = jest.fn(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw(Prisma.sql`UPDATE story_works
        SET summary = jsonb_build_object('qaWriteProbe', 'SYNTHETIC_ATTEMPTED_WRITE')
        WHERE id = ${workId}::uuid`);
    });
    const f = await fixture(attemptWrite);
    workId = f.work.id;
    try {
      let failure: unknown;
      // The catch runs outside the aborted transaction; no resume, retry or replacement result.
      try {
        await checked(f, () => f.service.originalReference(f.owner.id, f.work.id, { locale: 'ko' }));
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(failure).toMatchObject({ code: 'P2010', meta: { code: '25006' } });
      expect(attemptWrite).toHaveBeenCalledTimes(1);
      expect(f.transaction).toHaveBeenCalledTimes(1);
      expect(f.reads.map(row => row.model)).toEqual(['storyWork']);
    } finally {
      f.clearWorkReadProbe();
      attemptWrite.mockReset();
    }
  });
});
