import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { UserEntitlement } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryProductionService } from './story-production.service';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';

const READ_CURSORS = ['canonical', 'generated', 'generated-ending'] as const;
const DENIED_GRANTS = ['revoked', 'expired', 'missing', 'unrelated-part'] as const;
const ALLOWED_ACCESS = ['live-work-grant', 'exact-part-grant', 'free-work', 'free-current-part', 'public-beta'] as const;
const GRANTED_AT = new Date('2019-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');
const FUTURE = new Date('2100-01-01T00:00:00.000Z');
const BODY = 'The stored chapter remains readable only with current story access.';

type Cursor = typeof READ_CURSORS[number] | 'canonical-ending';
type AllowedAccess = typeof ALLOWED_ACCESS[number];
type DeniedGrant = typeof DENIED_GRANTS[number];
type Where = Record<string, unknown>;
type ReadArgs = { where: Where };
type Grant = Pick<UserEntitlement, 'id' | 'userId' | 'entitlementType' | 'referenceType' |
  'referenceId' | 'startsAt' | 'expiresAt' | 'revokedAt' | 'createdAt'>;

// Apply the actual read predicates, rather than returning a precomputed access decision.
function matches(row: object, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'OR') {
      return Array.isArray(expected) && expected.some(branch => matches(row, branch as Where));
    }
    const actual = (row as Record<string, unknown>)[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === 'in') return Array.isArray(value) && value.includes(actual);
        if (operator === 'not') return actual !== value;
        const left = actual instanceof Date ? actual.getTime() : actual;
        const right = value instanceof Date ? value.getTime() : value;
        if (typeof left !== 'number' || typeof right !== 'number') return false;
        if (operator === 'lte') return left <= right;
        if (operator === 'gt') return left > right;
        throw new Error(`Unexpected read filter: ${operator}`);
      });
    }
    return actual === expected;
  });
}

function readModel<T extends object>(rows: () => T[]) {
  return {
    findFirst: jest.fn(async ({ where }: ReadArgs) => {
      const row = rows().find(candidate => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    findUnique: jest.fn(async ({ where }: ReadArgs) => {
      const row = rows().find(candidate => matches(candidate, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where }: ReadArgs) => rows().filter(row => matches(row, where))),
  };
}

function accessFixture(cursor: Cursor, access: AllowedAccess = 'live-work-grant', owner = false) {
  const userId = randomUUID(), workId = randomUUID(), progressId = randomUUID();
  const releaseId = randomUUID(), partId = randomUUID(), otherPartId = randomUUID();
  const canonicalId = randomUUID(), generatedId = randomUUID(), routeId = randomUUID();
  const sourceSceneId = randomUUID(), sourceChoiceId = randomUUID();
  const isGenerated = cursor === 'generated' || cursor === 'generated-ending';
  const completed = cursor === 'generated-ending' || cursor === 'canonical-ending';
  const sceneId = isGenerated ? generatedId : canonicalId;
  const sceneKey = isGenerated ? 'saved-generated-chapter' : 'saved-canonical-chapter';
  const manifest = (key: string) => ({
    sceneKey: key, background: { state: 'fallback', altKey: 'story.visual.fallback' },
    characters: [],
    fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
  });
  const work = {
    id: workId, ownerUserId: owner ? userId : randomUUID(), slug: 'published-current-access-story',
    status: 'published', fixtureSource: false, defaultLocale: 'en', supportedLocales: ['en'],
    title: { en: 'Published work' }, summary: {}, coverManifest: {},
    priceLumina: new Decimal(access === 'free-work' ? 0 : 100),
    activeReleaseId: releaseId, publishedVersion: 1, publishedAt: PAST,
  };
  const part = {
    id: partId, workId, status: 'published', fixtureSource: false,
    seasonKey: 'season-1', actNumber: 1, position: 1, title: { en: 'Current part' },
    priceLumina: new Decimal(access === 'free-current-part' ? 0 : 25),
  };
  const otherPart = { ...part, id: otherPartId, position: 2, title: { en: 'Unrelated paid part' } };
  const release = { id: releaseId, workId, status: 'active', version: 1, checksum: 'a'.repeat(64) };
  const canonical = {
    id: canonicalId, partId, sceneKey: 'saved-canonical-chapter', status: 'published',
    fixtureSource: false, position: 2, title: { en: 'Stored chapter' },
    endingType: cursor === 'canonical-ending' ? 'author_main' : null,
    visualManifest: manifest('saved-canonical-chapter'),
  };
  const sourceScene = { ...canonical, id: sourceSceneId, sceneKey: 'preceding-canonical-scene',
    position: 1, endingType: null, visualManifest: manifest('preceding-canonical-scene') };
  const sourceChoice = {
    id: sourceChoiceId, sceneId: sourceSceneId, choiceKey: 'arrive-at-ending', position: 1,
    label: { en: 'Finish this route' }, targetSceneId: canonicalId, targetEndingKey: null,
    declaredRejoinSceneId: null, routeKind: 'branch', createdAt: PAST,
  };
  const generated = {
    id: generatedId, continuationId: randomUUID(), userId, progressId, workId, releaseId,
    sourcePartId: partId, sceneKey: 'saved-generated-chapter', status: 'ready',
    title: { en: 'Stored chapter' }, endingType: completed ? 'ai_generated' : null,
    provenance: 'ai_generated', resultChecksum: 'b'.repeat(64), sharedResultId: null,
    visualManifest: manifest('saved-generated-chapter'), createdAt: PAST,
  };
  const progress = {
    id: progressId, userId, workId, activeReleaseId: releaseId,
    currentSceneId: isGenerated ? null : canonicalId,
    currentGeneratedSceneId: isGenerated ? generatedId : null,
    currentBeatPosition: 0, currentAct: 1, progressRevision: 7, storyVersion: 1,
    capabilityRevision: null, pathSummary: [],
    routeNodeId: cursor === 'canonical-ending' ? routeId : null,
    status: completed ? 'completed' : 'active',
  };
  const route = {
    id: routeId, progressId, workId, releaseId, parentId: null, depth: 1,
    stepKind: 'canonical', sourceSceneId, sourceChoiceId, targetSceneId: canonicalId,
    endingKey: null, actNumber: 1, createdAt: PAST,
  };
  const event = {
    id: randomUUID(), progressId, sceneId: sourceSceneId, choiceId: sourceChoiceId,
    targetSceneId: canonicalId, endingKey: null, endingType: 'author_main',
    explicitRejoin: false, invalidatedAt: null, resetCommandId: null, createdAt: PAST,
  };
  const beat = { id: randomUUID(), sceneId, position: 1, beatType: 'paragraph',
    content: { en: BODY }, sourceSceneKey: null, visualManifest: null };
  const grants: Grant[] = [{
    id: randomUUID(), userId, entitlementType: 'story_work', referenceType: 'story_work',
    referenceId: workId, startsAt: GRANTED_AT, expiresAt: FUTURE, revokedAt: null, createdAt: GRANTED_AT,
  }];
  if (access === 'exact-part-grant') {
    grants[0] = { ...grants[0], entitlementType: 'story_part', referenceType: 'story_part',
      referenceId: partId, expiresAt: null };
  }
  if (access === 'free-work' || access === 'free-current-part' || access === 'public-beta' || owner) grants.splice(0);
  const forbiddenWrite = jest.fn(async () => { throw new Error('Current scene access must not write'); });
  const prisma = {
    storyReaderProgress: { ...readModel(() => [progress]), update: forbiddenWrite },
    storyWork: readModel(() => [work]),
    storyRelease: readModel(() => [release]),
    storyPart: readModel(() => [part, otherPart]),
    storyScene: readModel(() => [canonical, sourceScene]),
    storyChoice: readModel(() => [sourceChoice]),
    storyBeat: readModel(() => isGenerated ? [] : [beat]),
    storyAiGeneratedScene: readModel(() => [generated]),
    storyAiGeneratedBeat: readModel(() => isGenerated ? [beat] : []),
    storyAiGeneratedChoice: readModel(() => []),
    storyProgressRouteNode: readModel(() => [route]),
    storyChoiceEvent: readModel(() => [event]),
    userEntitlement: { ...readModel(() => grants), create: forbiddenWrite,
      update: forbiddenWrite, delete: forbiddenWrite },
    $transaction: forbiddenWrite,
  };
  const promptRepairAttempt = jest.fn();
  const checkVisualScope = (id: string, pinnedRelease: string, keys: string[]) => {
    expect([id, pinnedRelease, keys]).toEqual([workId, releaseId, [sceneKey]]);
  };
  const visualGeneration = {
    variantKeyForProgress: jest.fn(async (id: string) => {
      expect(id).toBe(progressId);
      return 'default';
    }),
    readyVisuals: jest.fn(async (id: string, pinnedRelease: string, keys: string[], variant: string) => {
      checkVisualScope(id, pinnedRelease, keys);
      expect(variant).toBe('default');
      return new Map([[sceneKey, { sourceSceneKey: sceneKey, publicAssetPath: '/assets/story/current.webp' }]]);
    }),
    promptKeys: jest.fn(async (id: string, pinnedRelease: string, keys: string[]) => {
      checkVisualScope(id, pinnedRelease, keys);
      promptRepairAttempt({ workId: id, releaseId: pinnedRelease, sourceSceneKey: keys[0] });
      return new Set([sceneKey]);
    }),
  };
  const betaSettings = {
    STORY_PUBLIC_BETA_ENABLED: access === 'public-beta' ? 'true' : 'false',
    STORY_PUBLIC_BETA_RELEASES: JSON.stringify([{ workId, releaseId,
      releaseChecksum: release.checksum, freeAccess: true }]),
  };
  const publicBeta = new StoryPublicBetaPolicy(new ConfigService(betaSettings));
  const service = new StoryProductionService(prisma as never,
    undefined, undefined, undefined, undefined, visualGeneration as never, publicBeta);
  const read = () => service.currentProgress(userId, progressId, 'en');
  return { userId, workId, progressId, releaseId, partId, otherPartId, sceneId, sceneKey,
    work, part, release, betaSettings, progress, grants, prisma, visualGeneration, promptRepairAttempt, forbiddenWrite, read };
}

function withdrawGrant(f: ReturnType<typeof accessFixture>, state: DeniedGrant) {
  if (state === 'missing') f.grants.splice(0);
  else if (state === 'revoked') f.grants[0].revokedAt = PAST;
  else if (state === 'expired') f.grants[0].expiresAt = PAST;
  else f.grants[0] = { ...f.grants[0], entitlementType: 'story_part', referenceType: 'story_part',
    referenceId: f.otherPartId };
}

async function expectExtraDenied(f: ReturnType<typeof accessFixture>) {
  const before = { ...f.progress, pathSummary: [...f.progress.pathSummary] };
  await expect(f.read()).rejects.toMatchObject({ status: 403 });
  expect(f.prisma.userEntitlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where:
    expect.objectContaining({ userId: f.userId, referenceId: { in: [f.workId, f.partId] }, revokedAt: null }) }));
  expect(f.prisma.storyBeat.findMany).not.toHaveBeenCalled();
  expect(f.prisma.storyChoice.findMany).not.toHaveBeenCalled();
  expect(f.prisma.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled();
  expect(f.prisma.storyAiGeneratedChoice.findMany).not.toHaveBeenCalled();
  expect(f.visualGeneration.variantKeyForProgress).not.toHaveBeenCalled();
  expect(f.visualGeneration.readyVisuals).not.toHaveBeenCalled();
  expect(f.visualGeneration.promptKeys).not.toHaveBeenCalled();
  expect(f.promptRepairAttempt).not.toHaveBeenCalled();
  expect(f.forbiddenWrite).not.toHaveBeenCalled();
  expect(f.progress).toEqual(before);
}

async function expectReadable(f: ReturnType<typeof accessFixture>) {
  await expect(f.read()).resolves.toMatchObject({
    progressId: f.progressId, workId: f.workId, status: f.progress.status, revision: 7,
    storyVersion: 1, scene: { id: f.sceneId, title: { value: 'Stored chapter', locale: 'en' },
      beats: [{ position: 1, content: { value: BODY, locale: 'en' } }],
      visualManifest: { background: { state: 'ready', publicAssetPath: '/assets/story/current.webp' } } },
    choices: [],
  });
  if (f.progress.currentGeneratedSceneId) {
    expect(f.visualGeneration.readyVisuals).toHaveBeenCalledWith(f.workId, f.releaseId, [f.sceneKey], 'default');
  }
  expect(f.visualGeneration.promptKeys).toHaveBeenCalled();
  expect(f.promptRepairAttempt).toHaveBeenCalled();
  expect(f.forbiddenWrite).not.toHaveBeenCalled();
}

describe('current scene paid access boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  describe.each(READ_CURSORS)('%s', cursor => {
    it.each(DENIED_GRANTS)('current paid access denies %s before narrative projection or prompt repair', async state => {
      const f = accessFixture(cursor);
      const before = { ...f.progress, pathSummary: [...f.progress.pathSummary] };
      await expectReadable(f);
      withdrawGrant(f, state);
      jest.clearAllMocks();

      await expect(f.read()).rejects.toMatchObject({ status: 403 });

      expect(f.prisma.userEntitlement.findMany.mock.calls.length +
        f.prisma.userEntitlement.findFirst.mock.calls.length).toBeGreaterThan(0);
      expect(f.prisma.storyBeat.findMany).not.toHaveBeenCalled();
      expect(f.prisma.storyChoice.findMany).not.toHaveBeenCalled();
      expect(f.prisma.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled();
      expect(f.prisma.storyAiGeneratedChoice.findMany).not.toHaveBeenCalled();
      expect(f.visualGeneration.variantKeyForProgress).not.toHaveBeenCalled();
      expect(f.visualGeneration.readyVisuals).not.toHaveBeenCalled();
      expect(f.visualGeneration.promptKeys).not.toHaveBeenCalled();
      expect(f.promptRepairAttempt).not.toHaveBeenCalled();
      expect(f.forbiddenWrite).not.toHaveBeenCalled();
      expect(f.progress).toEqual(before);
    });

    it.each(ALLOWED_ACCESS)('preserves readable current scene with %s', async access => {
      const f = accessFixture(cursor, access);
      await expectReadable(f);
      expect(f.work.priceLumina.toString()).toBe(access === 'free-work' ? '0' : '100');
      expect(f.part.priceLumina.toString()).toBe(access === 'free-current-part' ? '0' : '25');
    });
  });

  it('preserves the paid canonical owner ending exception with stored route evidence and no grant', async () => {
    const f = accessFixture('canonical-ending', 'live-work-grant', true);
    expect(f.grants).toEqual([]);
    await expectReadable(f);
    expect(f.prisma.storyProgressRouteNode.findFirst).toHaveBeenCalled();
    expect(f.prisma.storyChoiceEvent.findFirst).toHaveBeenCalled();
    expect(f.work.ownerUserId).toBe(f.userId);
    expect(f.work.priceLumina.toString()).toBe('100');
    expect(f.part.priceLumina.toString()).toBe('25');
  });

  it('extra access boundary preserves a paid canonical owner ending with a missing current pointer', async () => {
    const f = accessFixture('canonical-ending', 'live-work-grant', true);
    f.progress.currentSceneId = null;
    expect(f.grants).toEqual([]);
    expect(f.work.priceLumina.toString()).toBe('100');
    expect(f.part.priceLumina.toString()).toBe('25');
    await expectReadable(f);
    expect(f.prisma.storyProgressRouteNode.findFirst).toHaveBeenCalled();
    expect(f.prisma.storyChoiceEvent.findFirst).toHaveBeenCalled();
    expect(f.prisma.userEntitlement.findMany).not.toHaveBeenCalled();
    expect(f.progress).toMatchObject({ currentSceneId: null, status: 'completed', progressRevision: 7 });
  });

  it.each(READ_CURSORS)('extra access boundary denies a no-grant owner on ordinary %s', async cursor => {
    const f = accessFixture(cursor, 'live-work-grant', true);
    expect(f.work.ownerUserId).toBe(f.userId);
    expect(f.grants).toEqual([]);
    expect(f.work.priceLumina.toString()).toBe('100');
    expect(f.part.priceLumina.toString()).toBe('25');
    await expectExtraDenied(f);
  });

  it.each(['current-release-mismatch', 'checksum-mismatch', 'disabled', 'nonfree'] as const)(
    'extra access boundary denies beta %s before body or repair', async state => {
      const f = accessFixture('canonical', 'public-beta');
      await expectReadable(f);
      jest.clearAllMocks();
      if (state === 'current-release-mismatch') {
        f.release.id = randomUUID();
        f.work.activeReleaseId = f.release.id;
        expect(f.progress.activeReleaseId).not.toBe(f.work.activeReleaseId);
      }
      if (state === 'checksum-mismatch') f.release.checksum = 'b'.repeat(64);
      if (state === 'disabled') f.betaSettings.STORY_PUBLIC_BETA_ENABLED = 'false';
      if (state === 'nonfree') f.betaSettings.STORY_PUBLIC_BETA_RELEASES = JSON.stringify([
        { workId: f.workId, releaseId: f.release.id, releaseChecksum: f.release.checksum, freeAccess: false },
      ]);
      await expectExtraDenied(f);
      expect(f.prisma.storyRelease.findFirst).toHaveBeenCalledWith({ where: {
        id: f.work.activeReleaseId, workId: f.workId, status: 'active',
      }, select: { id: true, checksum: true } });
    },
  );
});
