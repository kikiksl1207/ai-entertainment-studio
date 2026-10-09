import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import * as contextPolicy from './story-continuation-context.policy';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';

function fixture(oversized = false) {
  const owner = randomUUID(), workId = randomUUID(), releaseId = randomUUID(), manuscript = randomUUID();
  const work = { id: workId, ownerUserId: owner, activeReleaseId: releaseId, publishedVersion: 1,
    status: 'published', fixtureSource: false };
  const release = { id: releaseId, workId, status: 'active', version: 1,
    manuscriptVersionId: manuscript, checksum: 'a'.repeat(64) };
  const capability = { workId, releaseId, status: 'active', revision: 1, hardBudgetKrw: new Prisma.Decimal(300) };
  const consent = { id: randomUUID(), workId, ownerUserId: owner, manuscriptVersionId: manuscript,
    status: 'active', revision: 1, rightsConfirmed: true, aiBranchAllowed: true,
    startsAt: new Date(0), expiresAt: null };
  const analysis = { id: randomUUID(), workId, manuscriptVersionId: manuscript,
    status: 'completed', analysisVersion: 1 };
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [],
      value: { summary: key, ...(oversized && key === 'writing_style' ? {
        syntheticPadding: ['S'.repeat(6000), 'T'.repeat(6000), 'U'.repeat(6000)],
      } : {}) } })),
  });
  const profile = { id: randomUUID(), workId, ownerUserId: owner, manuscriptVersionId: manuscript,
    analysisJobId: analysis.id, status: 'approved', profileVersion: 1, reviewRevision: 1,
    sourceFingerprint: 'b'.repeat(64), approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint('b'.repeat(64), settings) };
  const approval = { id: randomUUID(), userId: owner, workId, releaseId, status: 'active',
    manuscriptVersionId: manuscript, releaseChecksum: release.checksum, capabilityRevision: 1,
    styleConsentId: consent.id, styleConsentRevision: 1, analysisJobId: analysis.id, analysisVersion: 1,
    generationProfileId: profile.id, generationProfileRevision: 1, generationProfileFingerprint: profile.approvedFingerprint,
    approvedBudgetKrw: new Prisma.Decimal(10000), expiresAt: new Date(Date.now() + 60000) };
  const forbid = jest.fn(() => { throw new Error('Synthetic mutation forbidden'); });
  const delegate = (read: string, value: object) => ({ [read]: jest.fn(async () => value),
    create: forbid, update: forbid, updateMany: forbid, upsert: forbid });
  const tx: any = { $executeRaw: jest.fn(async () => 0), $queryRaw: jest.fn(async () => []),
    storyWork: { ...delegate('findFirst', work), findFirst: jest.fn(async ({ where }) =>
      where.ownerUserId === owner && work.status === 'published' && !work.fixtureSource ? work : null) },
    storyAuthorBodyTrialApproval: { ...delegate('findFirst', approval), findFirst: jest.fn(async ({ where }) =>
      approval.status === 'active' && approval.expiresAt > where.expiresAt.gt && where.userId === owner ? approval : null) },
    storyRelease: delegate('findFirst', release), storyReleaseCapability: delegate('findUnique', capability),
    storyStyleProfileConsent: delegate('findUnique', consent), storyAnalysisJob: delegate('findFirst', analysis),
    storyWorkGenerationProfile: delegate('findFirst', profile) };
  const costs = { snapshotTx: forbid, provisionalBudgetTx: forbid };
  const service = new StoryAuthorBodyTrialService(costs as never);
  const scope = { workId, approvalId: approval.id };
  return { owner, work, release, capability, consent, analysis, profile, approval, tx, costs, service, scope, forbid };
}

describe('author body trial profile fit admission (synthetic, no provider)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(true); });
  afterEach(() => { expect(f.forbid).not.toHaveBeenCalled(); });

  it('accepts a fitting current approved profile without changing its allowance or approval', async () => {
    f = fixture(false);
    const before = JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability });
    await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).resolves.toBe(f.approval);
    expect(JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability })).toBe(before);
  });

  it('rejects a valid oversized approved profile with a fixed safe diagnosis before dispatch', async () => {
    const before = JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability });
    await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).rejects.toMatchObject({
      status: 409, response: { code: 'STORY_AUTHOR_BODY_TRIAL_PROFILE_CONTEXT_TOO_LARGE', generationStarted: false },
    });
    expect(JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability })).toBe(before);
  });

  it('refuses worker dispatch for the same oversized profile without a budget snapshot', async () => {
    expect(await f.service.authorizeDispatchTx(f.tx, {
      authorBodyTrialApprovalId: f.approval.id, userId: f.owner, workId: f.scope.workId,
      releaseId: f.release.id, manuscriptVersionId: f.approval.manuscriptVersionId,
      styleConsentId: f.consent.id, styleConsentRevision: 1, capabilityRevision: 1,
      analysisJobId: f.analysis.id, analysisVersion: 1, maxAttempts: 1,
    })).toBe(false);
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  it.each(['fingerprint', 'revision', 'withdrawn', 'consent'])(
    'preserves %s rejection instead of disguising it as a size issue', async mode => {
      if (mode === 'fingerprint') f.profile.sourceFingerprint = 'c'.repeat(64);
      if (mode === 'revision') f.profile.reviewRevision++;
      if (mode === 'withdrawn') f.profile.status = 'needs_review';
      if (mode === 'consent') f.consent.rightsConfirmed = false;
      await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).rejects.toMatchObject({
        response: { code: 'STORY_AUTHOR_BODY_TRIAL_APPROVAL_CHANGED', generationStarted: false },
      });
    },
  );

  it('does not renew an expired approval to diagnose its profile', async () => {
    f.approval.expiresAt = new Date(0);
    await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    expect(f.approval.expiresAt).toEqual(new Date(0));
  });

  it('hides a foreign work rather than exposing its profile condition', async () => {
    await expect(f.service.authorizeTx(f.tx, randomUUID(), f.scope)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
  });

  it('keeps expiry during pin reads ahead of an oversized-profile diagnosis', async () => {
    f.tx.storyWorkGenerationProfile.findFirst.mockImplementationOnce(async () => {
      f.approval.expiresAt = new Date(0); return f.profile;
    });
    await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).rejects.toMatchObject({
      response: { code: 'STORY_AUTHOR_BODY_TRIAL_APPROVAL_CHANGED', generationStarted: false },
    });
    expect(f.approval.expiresAt).toEqual(new Date(0));
  });

  it('rejects malformed scope before any locks or reads', async () => {
    await expect(f.service.authorizeTx(f.tx, f.owner, { ...f.scope, workId: 'invalid' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.tx.storyWork.findFirst).not.toHaveBeenCalled();
  });

  it.each([new Error('Synthetic private diagnostic'), { message: 'generation_profile_context_too_large' }])(
    'keeps unknown and non-Error failures fail-closed without exposing diagnostics', async error => {
      const check = jest.spyOn(contextPolicy, 'continuationGenerationProfileSnapshot')
        .mockImplementationOnce(() => { throw error; });
      try {
        await expect(f.service.authorizeTx(f.tx, f.owner, f.scope)).rejects.toMatchObject({
          response: { code: 'STORY_AUTHOR_BODY_TRIAL_APPROVAL_CHANGED', generationStarted: false },
        });
      } finally { check.mockRestore(); }
    },
  );
});
