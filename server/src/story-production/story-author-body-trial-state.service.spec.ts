import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';
import { StoryAuthorBodyTrialBudgetError } from './story-author-body-trial-budget.policy';
import { authorBodyTrialHistoricalSeparationReference } from './story-author-body-trial-budget.policy';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import * as contextPolicy from './story-continuation-context.policy';

const userId = randomUUID(), workId = randomUUID(), releaseId = randomUUID();
function fixture() {
  const write = jest.fn(() => { throw new Error('Unexpected mutation'); });
  const work: any = { id: workId, ownerUserId: userId, activeReleaseId: releaseId, publishedVersion: 1,
    status: 'published', fixtureSource: false };
  const manuscriptVersionId = randomUUID();
  const release: any = { id: releaseId, workId, status: 'active', version: 1, manuscriptVersionId, checksum: 'a'.repeat(64) };
  const capability: any = { workId, releaseId, status: 'active', revision: 1, hardBudgetKrw: new Prisma.Decimal('300') };
  const consent: any = { id: randomUUID(), workId, ownerUserId: userId, manuscriptVersionId, status: 'active',
    revision: 1, rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0), expiresAt: null };
  const analysis: any = { id: randomUUID(), workId, manuscriptVersionId, status: 'completed', analysisVersion: 1 };
  const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', value: { summary: key }, evidence: [] })) });
  const profile: any = { id: randomUUID(), workId, ownerUserId: userId, manuscriptVersionId, analysisJobId: analysis.id,
    status: 'approved', profileVersion: 1, reviewRevision: 1, sourceFingerprint: 'b'.repeat(64), approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint('b'.repeat(64), settings) };
  const approval: any = { id: randomUUID(), userId, workId, releaseId, status: 'active',
    manuscriptVersionId, releaseChecksum: release.checksum, capabilityRevision: capability.revision,
    styleConsentId: consent.id, styleConsentRevision: consent.revision, analysisJobId: analysis.id,
    analysisVersion: analysis.analysisVersion, generationProfileId: profile.id, generationProfileRevision: profile.reviewRevision,
    generationProfileFingerprint: profile.approvedFingerprint,
    approvedBudgetKrw: new Prisma.Decimal('10000'), expiresAt: new Date(Date.now() + 60000) };
  const tx = { $executeRaw: jest.fn(async (sql: { strings: string[] }) => {
    expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); return 0;
  }), storyWork: { findFirst: jest.fn(async ({ where }) =>
    Object.entries(where).every(([key, value]) => work[key] === value) ? work : null), create: write, update: write },
    storyAuthorBodyTrialApproval: { findFirst: jest.fn(async ({ where }) =>
      Object.entries(where).every(([key, value]) => approval[key] === value) ? approval : null), create: write, update: write },
    storyRelease: { findFirst: jest.fn(async () => release), create: write, update: write },
    storyReleaseCapability: { findUnique: jest.fn(async () => capability), create: write, update: write },
    storyStyleProfileConsent: { findUnique: jest.fn(async () => consent), create: write, update: write },
    storyAnalysisJob: { findFirst: jest.fn(async () => analysis), create: write, update: write },
    storyWorkGenerationProfile: { findFirst: jest.fn(async () => profile), create: write, update: write, upsert: write },
    $queryRaw: write, storyReaderProgress: { update: write }, storyAiContinuation: { create: write }, storyAiUsageLedger: { create: write } };
  const prisma = { $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, _options: unknown) => callback(tx)) };
  const snapshot: any = { userId, workId, complete: true, continuations: [], ledger: [] };
  const costs = { snapshotTx: jest.fn(async (_db: unknown, _user: string, _work: string) => snapshot) };
  const service = new StoryAuthorBodyTrialStateService(prisma as never, costs as never);
  return { work, release, capability, consent, analysis, profile, approval, tx, prisma, snapshot, costs, service, write };
}

describe('private author body trial recorded state (no providers)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { expect(f.write).not.toHaveBeenCalled(); });

  it('returns the exact recorded budget in a single read-only snapshot without granting generation', async () => {
    const value = await f.service.current(userId, workId);
    expect(value).toMatchObject({ contract: 'story-author-body-trial-state-v1', state: 'approval_recorded',
      readOnly: true, generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
      nextMaximumCostKrw: '300.000000', nextCostQuoteState: 'prepared', nextCostQuoteReason: null,
      approval: { id: f.approval.id, expiresAt: f.approval.expiresAt.toISOString() },
      budget: { approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '10000.000000', evidenceReadyForBudgetCheck: true } });
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(f.costs.snapshotTx).toHaveBeenCalledWith(f.tx, userId, workId);
    expect(JSON.stringify(value)).not.toMatch(/userId|releaseId|approvalReference|manuscript|styleConsent|fingerprint|approvedSettings|sourceFingerprint|rateCard/);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.storyReleaseCapability.findUnique).toHaveBeenCalledWith({ where: { releaseId },
      select: { workId: true, releaseId: true, status: true, revision: true, hardBudgetKrw: true } });
  });

  it('normalizes UUID case', async () => {
    expect(await f.service.current(userId.toUpperCase(), workId.toUpperCase())).toEqual(await f.service.current(userId, workId));
  });

  it.each([[userId, 'invalid'], ['invalid', workId]])('rejects invalid input before database access', async (user, work) => {
    await expect(f.service.current(user, work)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'unpublished', 'fixture'])('hides unavailable work: %s', async mode => {
    if (mode === 'foreign') f.work.ownerUserId = randomUUID();
    if (mode === 'unpublished') f.work.status = 'draft';
    if (mode === 'fixture') f.work.fixtureSource = true;
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.storyAuthorBodyTrialApproval.findFirst).not.toHaveBeenCalled();
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'missing', 'foreign'])('does not invent a grant or free budget: %s', async mode => {
    if (mode === 'revoked') f.approval.status = 'revoked';
    if (mode === 'foreign') f.approval.userId = randomUUID();
    if (mode === 'missing') f.tx.storyAuthorBodyTrialApproval.findFirst.mockResolvedValueOnce(null);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_required', approval: null, budget: null,
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'approval_required' });
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('shows an expired record without renewing it', async () => {
    f.approval.expiresAt = new Date(0);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_expired',
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'approval_expired' });
    expect(f.approval.expiresAt).toEqual(new Date(0));
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('shows a release change without copying approval to the new manuscript', async () => {
    f.work.activeReleaseId = randomUUID();
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'release_changed',
      nextMaximumCostKrw: null, nextCostQuoteReason: 'release_changed' });
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it.each(['-1', '0', '10000.000001', 'NaN', 'Infinity', '-Infinity'])('rejects an invalid recorded cap: %s', async cap => {
    f.approval.approvedBudgetKrw = new Prisma.Decimal(cap);
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(ConflictException);
    expect(f.costs.snapshotTx).not.toHaveBeenCalled();
  });

  function pending(actual: string | null = null, status = 'queued') {
    const id = randomUUID();
    f.snapshot.continuations.push({ id, userId, workId, requestKind: 'recommended_choice', status, attemptCount: 1,
      maxAttempts: 1, dispatchStartedAt: status === 'queued' ? null : new Date(), estimatedCostKrw: '0.25',
      hardBudgetKrw: '4000', actualCostKrw: actual, sharedResultReused: false, sharedResultEvidenceVerified: false,
      sharedResultId: null, resultGeneratedSceneId: null });
    const reserved = { id: randomUUID(), continuationId: id, userId, workId, eventKind: 'recommended_route_request',
      status: 'reserved', provenance: 'ai_generated', estimatedCostKrw: '0.25', actualCostKrw: null,
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0 };
    f.snapshot.ledger.push(reserved);
    if (status === 'failed') f.snapshot.ledger.push({ ...reserved, id: randomUUID(), eventKind: 'new_route_failed',
      status: 'failed', actualCostKrw: actual });
  }

  it('subtracts the committed maximum, not a cheap estimate', async () => {
    pending();
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded', budget: {
      committedCostKrw: '4000.000000', remainingBudgetKrw: '6000.000000' },
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'pending_cost' });
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('does not report spendable remaining money for unknown provider costs', async () => {
    pending(null, 'failed');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'cost_unknown', budget: {
      remainingBudgetKrw: null, unknownCostCount: 1, evidenceReadyForBudgetCheck: false },
      nextMaximumCostKrw: null, nextCostQuoteReason: 'cost_unknown' });
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('shows an exceeded cap without claiming a negative spendable balance', async () => {
    pending(); f.approval.approvedBudgetKrw = new Prisma.Decimal('3999.999999');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'budget_over_limit', budget: { remainingBudgetKrw: '0.000000' },
      nextMaximumCostKrw: null, nextCostQuoteReason: 'budget_over_limit' });
  });

  it('keeps a fully reserved cap distinct from invalid approval: zero-cost choices still require POST checks', async () => {
    pending(); f.approval.approvedBudgetKrw = new Prisma.Decimal('4000');
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded', budget: { remainingBudgetKrw: '0.000000' } });
  });

  it('rejects incomplete evidence without a sample fallback', async () => {
    f.snapshot.complete = false;
    await expect(f.service.current(userId, workId)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' } });
    f.costs.snapshotTx.mockRejectedValueOnce(new StoryAuthorBodyTrialBudgetError());
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('propagates database failure without issuing an approval', async () => {
    f.costs.snapshotTx.mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(f.service.current(userId, workId)).rejects.toThrow('Synthetic database failure');
  });

  it.each(['-1', '0', 'NaN', 'Infinity', '-Infinity', '0.0000001'])('withholds an invalid next maximum: %s', async amount => {
    f.capability.hardBudgetKrw = new Prisma.Decimal(amount);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded',
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'invalid_next_maximum',
      generationAuthorized: false, currentAuthorizationVerified: false });
  });

  it('does not invent a maximum when the capability has no amount', async () => {
    f.capability.hardBudgetKrw = null;
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
      nextCostQuoteReason: 'invalid_next_maximum' });
  });

  it.each(['queued', 'processing', 'retry_wait'])('withholds a quote while a request is pending: %s', async status => {
    pending(null, status);
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
      nextCostQuoteReason: 'pending_cost', budget: { pendingCount: 1 } });
  });

  it.each([
    ['9699.999999', '300.000000', 'prepared', null],
    ['9700', '300.000000', 'prepared', null],
    ['9700.000001', null, 'withheld', 'next_cost_exceeds_remaining'],
    ['10000', null, 'withheld', 'next_cost_exceeds_remaining'],
    ['10000.000001', null, 'withheld', 'budget_over_limit'],
  ])('uses exact cumulative costs at the six-decimal budget boundary: %s', async (actual, maximum, quoteState, reason) => {
    pending(actual!, 'failed');
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: maximum,
      nextCostQuoteState: quoteState, nextCostQuoteReason: reason, currentAuthorizationVerified: false });
  });

  it('projects the current capability amount rather than a fixture amount or past estimate', async () => {
    f.capability.hardBudgetKrw = new Prisma.Decimal('4000.25');
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: '4000.250000' });
  });

  it.each([
    ['release', 'id', randomUUID()], ['release', 'workId', randomUUID()], ['release', 'status', 'retired'],
    ['release', 'version', 2], ['release', 'manuscriptVersionId', randomUUID()], ['release', 'checksum', 'changed'],
    ['capability', 'workId', randomUUID()], ['capability', 'releaseId', randomUUID()],
    ['capability', 'status', 'draft'], ['capability', 'revision', 2],
    ['consent', 'id', randomUUID()], ['consent', 'workId', randomUUID()], ['consent', 'ownerUserId', randomUUID()],
    ['consent', 'manuscriptVersionId', randomUUID()], ['consent', 'status', 'withdrawn'], ['consent', 'revision', 2],
    ['consent', 'rightsConfirmed', false], ['consent', 'aiBranchAllowed', false],
    ['consent', 'startsAt', new Date(Date.now() + 86400000)], ['consent', 'expiresAt', new Date(0)],
    ['consent', 'startsAt', new Date(NaN)], ['consent', 'expiresAt', new Date(NaN)],
    ['analysis', 'id', randomUUID()], ['analysis', 'workId', randomUUID()], ['analysis', 'status', 'failed'],
    ['analysis', 'manuscriptVersionId', randomUUID()], ['analysis', 'analysisVersion', 2],
    ['profile', 'id', randomUUID()], ['profile', 'workId', randomUUID()], ['profile', 'ownerUserId', randomUUID()],
    ['profile', 'manuscriptVersionId', randomUUID()], ['profile', 'analysisJobId', randomUUID()],
    ['profile', 'status', 'needs_review'], ['profile', 'reviewRevision', 2],
    ['profile', 'approvedFingerprint', 'changed'], ['profile', 'sourceFingerprint', 'changed'],
    ['profile', 'approvedSettings', null], ['profile', 'approvedSettings', {}],
  ])('withholds when the current pin changed: %s.%s', async (row, key, value) => {
    (f as any)[row as string][key as string] = value;
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded',
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'approval_pins_changed',
      generationAuthorized: false, currentAuthorizationVerified: false });
  });

  it.each(['storyRelease', 'storyReleaseCapability', 'storyStyleProfileConsent', 'storyAnalysisJob', 'storyWorkGenerationProfile'])
    ('withholds when a pinned row is missing: %s', async model => {
      const delegate = (f.tx as any)[model];
      (delegate.findUnique ?? delegate.findFirst).mockResolvedValueOnce(null);
      expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
        nextCostQuoteReason: 'approval_pins_changed' });
    });

  it('keeps legacy absence of a generation profile pinned without creating one', async () => {
    f.approval.generationProfileId = null;
    f.approval.generationProfileRevision = null;
    f.approval.generationProfileFingerprint = null;
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValueOnce(null);
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: '300.000000',
      nextCostQuoteState: 'prepared', currentAuthorizationVerified: false });
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
      nextCostQuoteReason: 'approval_pins_changed' });
  });

  it('rechecks expiration after quote reads without extending it', async () => {
    f.tx.storyReleaseCapability.findUnique.mockImplementationOnce(async () => {
      f.approval.expiresAt = new Date(0); return f.capability;
    });
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
      nextCostQuoteReason: 'approval_expired' });
    expect(f.approval.expiresAt).toEqual(new Date(0));
  });

  it('rejects an invalid approval expiry rather than projecting a quote', async () => {
    f.approval.expiresAt = new Date(NaN);
    await expect(f.service.current(userId, workId)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyReleaseCapability.findUnique).not.toHaveBeenCalled();
  });

  it('preserves the exact historical separation while withholding any new current unknown cost', async () => {
    pending(null, 'failed'); pending(null, 'timeout');
    const cutoff = new Date(Date.now() - 10000);
    for (const row of f.snapshot.continuations) {
      row.maxAttempts = 3; row.createdAt = new Date(0); row.authorBodyTrialApprovalId = null;
    }
    f.approval.createdAt = cutoff;
    f.approval.approvalReference = authorBodyTrialHistoricalSeparationReference(f.snapshot, cutoff);
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: '300.000000',
      budget: { historicalUnknownCostCount: 2, unknownCostCount: 0 } });
    pending(null, 'failed');
    f.snapshot.continuations[2].createdAt = new Date();
    f.snapshot.continuations[2].authorBodyTrialApprovalId = f.approval.id;
    expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
      nextCostQuoteReason: 'cost_unknown', budget: { historicalUnknownCostCount: 2, unknownCostCount: 1 } });
  });

  it('propagates quote read failure without a fallback maximum', async () => {
    f.tx.storyReleaseCapability.findUnique.mockRejectedValueOnce(new Error('Synthetic capability read failure'));
    await expect(f.service.current(userId, workId)).rejects.toThrow('Synthetic capability read failure');
  });

  function oversizedApprovedProfile() {
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [],
        value: { summary: key, ...(key === 'writing_style' ? {
          syntheticPadding: ['S'.repeat(6000), 'T'.repeat(6000), 'U'.repeat(6000)],
        } : {}) } })),
    });
    f.profile.approvedSettings = settings;
    f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, settings);
    f.approval.generationProfileFingerprint = f.profile.approvedFingerprint;
  }

  it('distinguishes a valid oversized profile without shortening it or granting generation', async () => {
    oversizedApprovedProfile();
    const before = JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability });
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_recorded',
      nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: 'approved_profile_context_too_large',
      generationAuthorized: false, currentAuthorizationVerified: false, readOnly: true });
    expect(JSON.stringify({ profile: f.profile, approval: f.approval, capability: f.capability })).toBe(before);
  });

  it.each(['fingerprint', 'revision', 'withdrawn'])(
    'keeps %s approval failure distinct from oversized context', async mode => {
      oversizedApprovedProfile();
      if (mode === 'fingerprint') f.profile.sourceFingerprint = 'c'.repeat(64);
      if (mode === 'revision') f.profile.reviewRevision++;
      if (mode === 'withdrawn') f.profile.status = 'needs_review';
      expect(await f.service.current(userId, workId)).toMatchObject({ nextMaximumCostKrw: null,
        nextCostQuoteReason: 'approval_pins_changed', generationAuthorized: false });
    },
  );

  it('keeps approval expiry ahead of a valid oversized profile', async () => {
    oversizedApprovedProfile(); f.approval.expiresAt = new Date(0);
    expect(await f.service.current(userId, workId)).toMatchObject({ state: 'approval_expired',
      nextMaximumCostKrw: null, nextCostQuoteReason: 'approval_expired' });
    expect(f.tx.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
  });

  it('does not expose an unknown context failure as an approved profile size diagnosis', async () => {
    const check = jest.spyOn(contextPolicy, 'continuationGenerationProfileSnapshot')
      .mockImplementationOnce(() => { throw new Error('Synthetic private diagnostic'); });
    try {
      const result = await f.service.current(userId, workId);
      expect(result).toMatchObject({ nextMaximumCostKrw: null, nextCostQuoteReason: 'approval_pins_changed' });
      expect(JSON.stringify(result)).not.toContain('Synthetic private diagnostic');
    } finally { check.mockRestore(); }
  });
});
