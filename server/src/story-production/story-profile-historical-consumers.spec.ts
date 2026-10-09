import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileSection,
} from '../generation-profile/creator-generation-profile.policy';
import {
  continuationGenerationProfileApprovalPin,
  continuationGenerationProfileSnapshot,
  continuationGenerationProfileVisualSnapshot,
} from './story-continuation-context.policy';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { bodyReviewHash } from './story-author-body-review.policy';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import { StoryVisualGenerationService } from './story-visual-generation.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(1), WORK = id(2), OLD_VIEW = 'story-profile-prompt-v4';
const LONG_WRITING = '\uac00'.repeat(6_000);
const hash = (label: string) => bodyReviewHash({ synthetic: label });

function approvedProfile(writingSummary = LONG_WRITING) {
  const approvedSettings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'visual_cast' ? 'edited' : 'accepted', evidence: [],
      value: {
        summary: key === 'writing_style' ? writingSummary : `${key}: synthetic approved guidance. `.repeat(12),
        ...(key === 'writing_style' ? { imitationBoundary: 'approved_work_only' } : {}),
        ...(key === 'visual_direction' ? {
          visualBible: { era: 'Synthetic archive', artStyle: 'Charcoal illustration', palette: 'Green and gray' },
          observations: [{ title: 'Lighting', detail: 'Preserve the approved cool archive lighting.' }],
        } : {}),
        ...(key === 'visual_cast' ? {
          characters: [{ name: 'Synthetic archivist', appearance: 'Adult woman, black hair, green jacket' }],
        } : {}),
      },
    })),
  });
  const sourceFingerprint = hash('profile-source');
  return {
    id: id(17), workId: WORK, ownerUserId: USER, manuscriptVersionId: id(7), analysisJobId: id(12),
    status: 'approved', profileVersion: 1, reviewRevision: 2, sourceFingerprint, approvedSettings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, approvedSettings),
  };
}

function storedApprovalPin(profile: ReturnType<typeof approvedProfile>) {
  return {
    id: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
    sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint,
  };
}

function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'userId_workId') return matches(row, value);
    if (value && typeof value === 'object') {
      if ('gt' in value) return row[key] > value.gt;
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      throw new Error(`Unexpected synthetic query predicate: ${key}`);
    }
    return row[key] === value;
  });
}

// Real consumer validators run against immutable synthetic source rows; no database is connected.
function historicalFixture() {
  const profile = approvedProfile();
  const state: Record<string, any> = {
    work: { id: WORK, ownerUserId: USER, fixtureSource: false, status: 'published', activeReleaseId: id(3),
      publishedVersion: 1, releaseRevision: 2, authorDisplayName: 'Synthetic author' },
    progress: { id: id(4), userId: USER, workId: WORK, status: 'completed', activeReleaseId: id(3),
      storyVersion: 1, progressRevision: 7, routeNodeId: id(5), currentSceneId: null,
      currentGeneratedSceneId: id(6), pathSummary: [] },
    release: { id: id(3), workId: WORK, status: 'active', version: 1,
      checksum: hash('release'), manuscriptVersionId: id(7) },
    manuscript: { id: id(7), workId: WORK, ownerUserId: USER, contentHash: hash('manuscript'), locale: 'ko' },
    scene: { id: id(6), userId: USER, workId: WORK, progressId: id(4), releaseId: id(3), status: 'ready',
      provenance: 'ai_generated', continuationId: id(8), sourcePartId: id(9), endingType: 'ai_generated',
      sceneKey: `ai-${id(8)}`, title: { ko: 'Synthetic archive ending' }, visualManifest: {}, resultChecksum: '' },
    origin: { id: id(8), userId: USER, workId: WORK, progressId: id(4), releaseId: id(3),
      resultGeneratedSceneId: id(6), status: 'completed', sourcePartId: id(9), manuscriptVersionId: id(7),
      releaseChecksum: hash('release'), locale: 'ko', contextFingerprint: hash('context'),
      sourceRouteNodeId: id(10), sourceRouteHash: hash('source-route'), sourceProgressRevision: 3,
      contextReferences: { memoryPins: [], generationProfilePin: storedApprovalPin(profile),
        generationProfileViewVersion: OLD_VIEW }, styleConsentId: id(11), styleConsentRevision: 1,
      capabilityRevision: 1, analysisJobId: id(12), analysisVersion: 1 },
    part: { id: id(9), workId: WORK, status: 'published', fixtureSource: false },
    route: { id: id(5), progressId: id(4), workId: WORK, releaseId: id(3), parentId: id(10),
      narrativeStep: { generatedSceneId: id(6) }, routeHash: hash('route') },
    consent: { id: id(11), workId: WORK, ownerUserId: USER, manuscriptVersionId: id(7), status: 'active',
      revision: 1, rightsConfirmed: true, aiBranchAllowed: true, withdrawnAt: null,
      deletionRequestedAt: null, deletedAt: null, startsAt: new Date(0), expiresAt: null, allowedLocales: ['ko'] },
    capability: { workId: WORK, releaseId: id(3), status: 'active', revision: 1 },
    analysis: { id: id(12), workId: WORK, manuscriptVersionId: id(7), status: 'completed',
      analysisVersion: 1, pipeline: 'semantic_extraction_v1' },
    profile,
    beats: [{ id: id(13), sceneId: id(6), position: 1, beatType: 'paragraph',
      content: { ko: 'The synthetic archivist closes the final ledger.' } }],
    choices: [],
    discoveries: [{ id: id(15), userId: USER, workId: WORK, releaseId: id(3), pathSignature: bodyReviewHash([]),
      endingKind: 'ai_generated', provenance: 'ai_generated', endingKey: 'synthetic-ending' }],
  };
  state.scene.resultChecksum = storyAiResultChecksum({ title: state.scene.title, beats: state.beats,
    visualManifest: state.scene.visualManifest, nextChoices: state.choices, ending: { endingKey: 'synthetic-ending' } });
  const writes = jest.fn(() => { throw new Error('Historical consumer unit forbids database writes'); });
  const db: any = { auditEvent: { create: writes }, $connect: writes,
    $executeRawUnsafe: writes, $queryRawUnsafe: writes };
  const models = { storyWork: 'work', storyReaderProgress: 'progress', storyRelease: 'release',
    storyManuscriptVersion: 'manuscript', storyAiGeneratedScene: 'scene', storyAiContinuation: 'origin',
    storyPart: 'part', storyProgressRouteNode: 'route', storyStyleProfileConsent: 'consent',
    storyReleaseCapability: 'capability', storyAnalysisJob: 'analysis', storyWorkGenerationProfile: 'profile',
    storyAiGeneratedBeat: 'beats', storyAiGeneratedChoice: 'choices', storyEndingDiscovery: 'discoveries' };
  for (const [model, property] of Object.entries(models)) {
    const rows = (query: any) => {
      const value = state[property], available = Array.isArray(value) ? value : value ? [value] : [];
      return available.filter((row: Record<string, any>) => matches(row, query.where)).slice(0, query.take ?? Infinity);
    };
    db[model] = { findFirst: jest.fn(async (query: any) => rows(query)[0] ?? null),
      findUnique: jest.fn(async (query: any) => rows(query)[0] ?? null), findMany: jest.fn(async (query: any) => rows(query)),
      create: writes, update: writes, updateMany: writes, delete: writes, deleteMany: writes, upsert: writes };
  }
  db.$executeRaw = jest.fn(async (sql: Prisma.Sql) => {
    if (sql.strings.join('').trim() !== 'SET TRANSACTION READ ONLY') return writes();
    return 0;
  });
  db.$queryRaw = jest.fn(async (sql: Prisma.Sql) => {
    const text = sql.strings.join('?');
    if (!text.includes('FROM story_author_body_reviews r') || !text.includes('ORDER BY r.version DESC LIMIT 1') ||
        /FOR (?:UPDATE|SHARE)|INSERT|UPDATE|DELETE/.test(text)) return writes();
    expect(sql.values).toEqual([USER, WORK]);
    return [];
  });
  const prisma: any = { $transaction: jest.fn(async (run: (client: any) => unknown) => run(db)),
    $connect: writes, $executeRaw: writes, $queryRaw: writes };
  const participants = { pinnedContext: jest.fn().mockResolvedValue(null) };
  const review = new StoryAuthorBodyReviewService(prisma, participants as never);
  return { state, db, prisma, writes, review, read: () => review.current(USER, WORK, 'ko') };
}

function historicalVisualFixture() {
  const f = historicalFixture();
  const service = new StoryVisualGenerationService(f.db, { get: jest.fn() } as never);
  jest.spyOn(Reflect.get(service, 'logger'), 'warn').mockImplementation();
  const register = jest.spyOn(service, 'registerAiBranchPrompt').mockResolvedValue({
    workId: WORK, releaseId: id(3), generatedSceneId: id(6), sourceSceneKey: `ai-${id(8)}`, created: true,
  });
  const result = { title: { ...f.state.scene.title }, beats: f.state.beats.map((beat: any) => ({
    beatType: beat.beatType, content: { ...beat.content },
  })) };
  return { ...f, service, register,
    registerPrompt: () => service.registerGeneratedContinuationPrompt(id(8), result) };
}

describe('Historical profile consumers do not require the full continuation prompt view', () => {
  let provider: jest.SpyInstance;
  beforeEach(() => {
    provider = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Historical consumer unit forbids provider calls');
    });
  });
  afterEach(() => {
    try { expect(provider).not.toHaveBeenCalled(); }
    finally { jest.restoreAllMocks(); }
  });

  it('validates the unchanged approval pin while new full generation still rejects 6000 Korean characters', () => {
    const profile = approvedProfile(), original = JSON.stringify(profile.approvedSettings);
    expect(Buffer.byteLength(LONG_WRITING, 'utf8')).toBeGreaterThan(16_384);
    expect(continuationGenerationProfileApprovalPin(profile as never)).toEqual(storedApprovalPin(profile));
    expect(() => continuationGenerationProfileSnapshot(profile as never))
      .toThrow('generation_profile_context_too_large');
    expect(JSON.stringify(profile.approvedSettings)).toBe(original);
  });

  it.each(['status', 'fingerprint', 'excluded-writing-tail'])(
    'both identity and visual helpers still reject changed approval (%s)', change => {
      const profile = approvedProfile();
      if (change === 'status') profile.status = 'needs_review';
      else if (change === 'fingerprint') profile.approvedFingerprint = 'b'.repeat(64);
      else profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
        ...profile.approvedSettings,
        sections: profile.approvedSettings.sections.map(section => section.key !== 'writing_style'
          ? section : { ...section, value: { ...section.value, summary: `${LONG_WRITING} Unapproved exception.` } }),
      });
      const code = change === 'status' ? 'generation_profile_not_approved' : 'generation_profile_fingerprint_changed';
      expect(() => continuationGenerationProfileApprovalPin(profile as never)).toThrow(code);
      expect(() => continuationGenerationProfileVisualSnapshot(profile as never)).toThrow(code);
    },
  );

  it('projects exactly the existing two visual sections without unrelated writing or branch constraints', () => {
    const profile = approvedProfile(), original = JSON.stringify(profile.approvedSettings);
    const small = continuationGenerationProfileSnapshot(approvedProfile('Short synthetic style.') as never);
    const expected = { schemaVersion: small.approved.schemaVersion, sections: small.approved.sections.filter(section =>
      section.key === 'visual_direction' || section.key === 'visual_cast') };
    const visual = continuationGenerationProfileVisualSnapshot(profile as never);

    expect(visual).toEqual({ pin: storedApprovalPin(profile), approved: expected });
    expect(visual.approved.sections.map(section => section.key).sort()).toEqual(['visual_cast', 'visual_direction']);
    expect(JSON.stringify(visual.approved)).not.toMatch(/writing_style|branch_behavior/);
    expect(JSON.stringify(profile.approvedSettings)).toBe(original);
  });

  it.each(['unknown', 'removed', 'proposed'] as const)(
    'does not promote %s visual_cast into the visual projection', decision => {
      const profile = approvedProfile();
      profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
        ...profile.approvedSettings,
        sections: profile.approvedSettings.sections.map(section => section.key !== 'visual_cast'
          ? section : { ...section, decision: decision as CreatorGenerationProfileSection['decision'] }),
      });
      profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
      const visual = continuationGenerationProfileVisualSnapshot(profile as never);
      expect(visual.pin).toEqual(storedApprovalPin(profile));
      expect(visual.approved.sections.map(section => section.key)).toEqual(['visual_direction']);
      expect(JSON.stringify(visual.approved)).not.toContain('Synthetic archivist');
    },
  );

  it('keeps the completed old-v4 body reviewable with a valid pin without rewriting historical references', async () => {
    const f = historicalFixture(), original = JSON.stringify(f.state.origin.contextReferences);
    expect(() => continuationGenerationProfileSnapshot(f.state.profile)).toThrow('generation_profile_context_too_large');
    await expect(f.read()).resolves.toMatchObject({ state: 'reviewable', readOnly: true, latestReview: null,
      target: { sceneId: id(6), ending: true, bodyChecksum: f.state.scene.resultChecksum,
        sourceBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(JSON.stringify(f.state.origin.contextReferences)).toBe(original);
    expect(f.state.origin.contextReferences.generationProfileViewVersion).toBe(OLD_VIEW);
    expect(f.writes).not.toHaveBeenCalled();
  });

  it.each([
    ['new approval revision', (state: Record<string, any>) => { state.profile.reviewRevision++; }],
    ['approval withdrawn', (state: Record<string, any>) => { state.profile.status = 'needs_review'; }],
    ['approval fingerprint mismatch', (state: Record<string, any>) => { state.profile.approvedFingerprint = 'b'.repeat(64); }],
    ['profile owner changed', (state: Record<string, any>) => { state.profile.ownerUserId = id(99); }],
    ['manuscript replaced', (state: Record<string, any>) => { state.manuscript.id = id(99); }],
    ['consent withdrawn', (state: Record<string, any>) => { state.consent.withdrawnAt = new Date(0); }],
    ['rights revoked', (state: Record<string, any>) => { state.consent.rightsConfirmed = false; }],
    ['branch permission revoked', (state: Record<string, any>) => { state.consent.aiBranchAllowed = false; }],
    ['capability revision changed', (state: Record<string, any>) => { state.capability.revision++; }],
    ['stored body changed', (state: Record<string, any>) => { state.beats[0].content.ko = 'Changed synthetic body.'; }],
  ] as const)('still makes the historical body unavailable after %s', async (_name, change) => {
    const f = historicalFixture(); change(f.state);
    await expect(f.read()).resolves.toMatchObject({ state: 'source_changed', target: null });
    expect(f.writes).not.toHaveBeenCalled();
  });

  it('still denies a different work owner before reading the historical review', async () => {
    const f = historicalFixture(); f.state.work.ownerUserId = id(99);
    await expect(f.read()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_REVIEW_UNAVAILABLE' } });
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });

  it('registers the old-v4 stored branch visual prompt using only unchanged visual direction and cast', async () => {
    const f = historicalVisualFixture(), original = JSON.stringify(f.state.origin.contextReferences);
    const visual = continuationGenerationProfileVisualSnapshot(f.state.profile);
    await expect(f.registerPrompt()).resolves.toMatchObject({ created: true });
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(f.register).toHaveBeenCalledWith(WORK, id(6), expect.objectContaining({
      releaseId: id(3), releaseChecksum: f.state.release.checksum,
    }));
    const promptText = f.register.mock.calls[0][2].promptText;
    expect(promptText).toContain(JSON.stringify(visual.approved));
    expect(promptText).toContain('Charcoal illustration');
    expect(promptText).toContain('Adult woman, black hair, green jacket');
    expect(promptText).not.toMatch(/writing_style|branch_behavior/);
    expect(promptText).not.toContain(LONG_WRITING);
    expect(JSON.stringify(f.state.origin.contextReferences)).toBe(original);
    expect(f.writes).not.toHaveBeenCalled();
  });

  it.each(['revision', 'status', 'fingerprint', 'manuscript-scope', 'excluded-writing-tail'])(
    'does not register a historical visual prompt under a changed profile (%s)', async change => {
      const f = historicalVisualFixture();
      if (change === 'revision') f.state.profile.reviewRevision++;
      else if (change === 'status') f.state.profile.status = 'needs_review';
      else if (change === 'fingerprint') f.state.profile.approvedFingerprint = 'b'.repeat(64);
      else if (change === 'manuscript-scope') f.state.profile.manuscriptVersionId = id(99);
      else f.state.profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
        ...f.state.profile.approvedSettings,
        sections: f.state.profile.approvedSettings.sections.map((section: CreatorGenerationProfileSection) =>
          section.key !== 'writing_style' ? section : {
            ...section, value: { ...section.value, summary: `${LONG_WRITING} Unapproved exception.` },
          }),
      });
      await expect(f.registerPrompt()).rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
      expect(f.register).not.toHaveBeenCalled();
      expect(f.writes).not.toHaveBeenCalled();
    },
  );
});
