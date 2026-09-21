import { PrismaClient, StoryReaderProgress } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryAiActivationService } from './story-ai-activation.service';
import { StoryEconomicsService } from './story-economics.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { PersistedStoryReusableResultApprovalGate } from './story-reusable-result-approval.gate';
import { INTERNAL_GENERATION_COST_TREATMENT } from '../story-settlement/content-rights-contract.contract';
import { STORY_AI_QUALITY_EVALUATOR, STORY_AI_QUALITY_RUBRIC } from './dto/story-ai-activation.dto';

export function postgresClient() {
  const url = process.env.STORY_TEST_DATABASE_URL!;
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/(qa|test)/i.test(parsed.pathname)) {
    throw new Error('Dedicated loopback test database required');
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

// All fixtures are synthetic. Constraints/triggers remain enabled, including setup.
export async function activationFixture(db: PrismaClient, activate = true, reuseAllowed = true) {
  const owner = await db.user.create({ data: {} });
  const reader = await db.user.create({ data: {} });
  const second = await db.user.create({ data: {} });
  const work = await db.storyWork.create({ data: {
    ownerUserId: owner.id, slug: `activation-test-${randomUUID()}`, title: { ko: 'Synthetic story' }, summary: {},
  } });
  const manuscript = await db.storyManuscriptVersion.create({ data: {
    workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko', contentHash: 'a'.repeat(64), structuredBody: {},
  } });
  const part = await db.storyPart.create({ data: { workId: work.id, position: 1, title: {} } });
  const scene = await db.storyScene.create({ data: { partId: part.id, sceneKey: 'source', position: 1, title: { ko: 'Source scene' } } });
  await db.storyBeat.create({ data: { sceneId: scene.id, position: 1, beatType: 'paragraph', content: { ko: 'Synthetic public source.' } } });
  const choice = await db.storyChoice.create({ data: {
    sceneId: scene.id, choiceKey: 'branch-b', position: 1, label: { ko: 'Explore another path' }, routeKind: 'generation_required',
  } });
  const release = await db.storyRelease.create({ data: {
    workId: work.id, version: 1, status: 'active', manuscriptVersionId: manuscript.id, checksum: 'b'.repeat(64),
    branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: owner.id,
  } });
  await db.storyWork.update({ where: { id: work.id }, data: { status: 'published', activeReleaseId: release.id } });
  const consent = await db.storyStyleProfileConsent.create({ data: {
    workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id, rightsConfirmed: true,
    aiBranchAllowed: true, allowedLocales: ['ko'], allowedRegions: ['KR'], startsAt: new Date(0),
  } });
  const contract = await db.contentRightsContract.create({ data: { workType: 'story', workId: work.id, createdByUserId: owner.id } });
  const rights = await db.contentRightsContractVersion.create({ data: {
    contractId: contract.id, revision: 1, contentVersionId: manuscript.id, exclusivity: 'nonexclusive',
    media: ['story_publication'], regions: ['KR'], startsAt: new Date(0), effectiveFrom: new Date(0),
    saleAllowed: true, aiTransformationAllowed: true, generatedResultReuseAllowed: reuseAllowed, approvalState: 'approved_configuration',
    authorRightsHolderShareBps: 4500, salesAgencyShareBps: 500, companyShareBps: 5000,
    pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved', paidPointPolicy: 'unresolved',
    bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved', internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
    createdByUserId: owner.id, approvedByUserId: owner.id,
  } });
  await db.storyAnalysisJob.create({ data: {
    workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1,
    idempotencyKey: randomUUID(), status: 'completed',
  } });
  const rate = await db.storyAiRateCard.create({ data: {
    version: randomUUID(), provider: 'offline-test', model: 'synthetic-v1', status: 'active',
    inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: owner.id,
  } });
  const capability = await db.storyReleaseCapability.create({ data: {
    workId: work.id, releaseId: release.id, rateCardId: rate.id, status: 'active', includedAiRouteCount: 2,
    aiInputTokenLimit: 1000, aiOutputTokenLimit: 300, updatedByUserId: owner.id,
  } });
  const progresses: StoryReaderProgress[] = [];
  for (const user of [reader, second]) progresses.push(await db.storyReaderProgress.create({ data: {
    userId: user.id, workId: work.id, currentSceneId: scene.id, checkpointSceneId: scene.id,
    activeReleaseId: release.id, aiRateCardId: rate.id, capabilityRevision: capability.revision,
  } }));
  const activation = new StoryAiActivationService(db as never);
  const legal = new PersistedStoryContinuationLegalActivationGate(activation);
  const approval = new PersistedStoryReusableResultApprovalGate(activation);
  const provider = { readiness: jest.fn().mockResolvedValue({ enabled: true }), generate: jest.fn() };
  const economics = new StoryEconomicsService(db as never, legal, provider as never, approval);
  const activationBody = {
    releaseId: release.id, rightsContractVersionId: rights.id, consentId: consent.id, consentRevision: consent.revision,
    locale: 'ko', region: 'KR', moderationPolicyVersion: 'moderation-test-v1', moderationEvidenceVersion: 'admin-review-v1',
    qualityPolicyVersion: STORY_AI_QUALITY_RUBRIC, evidenceHash: 'c'.repeat(64),
    startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    legalActivationConfirmed: true,
  };
  const active = activate ? await activation.createActivation(owner.id, activationBody) : null;
  const context = {
    workId: work.id, releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
    rightsContractVersionId: rights.id, locale: 'ko',
  };
  async function request(index = 0) {
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: progresses[index].id } });
    return db.$transaction((tx) => economics.requestRecommendedChoiceTx(tx, {
      userId: progress.userId, progress, work, part, scene, release, choice,
      sourceKind: 'canonical', locale: 'ko', idempotencyKey: `fixture-${progress.id}`,
    }));
  }
  async function generatePersonal() {
    const first = await request();
    await db.storyAiContinuation.update({ where: { id: first.continuationId }, data: {
      status: 'processing', leaseToken: 'offline-lease', leaseOwner: 'fixture',
      leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1,
    } });
    await economics.settleContinuation(null, first.continuationId, {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0, inputTokens: 10, outputTokens: 10,
      cachedInputTokens: 0, imageUnits: 0, resultTitle: { ko: 'Synthetic private continuation' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: 'Synthetic generated continuation.' } }],
      resultVisualManifest: {
        sceneKey: `ai-${first.continuationId}`, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      }, nextChoices: [{ choiceKey: 'next', label: { ko: 'Continue' } }],
    }, `settle-${first.continuationId}`, 'offline-lease');
    return db.storyAiContinuation.findUniqueOrThrow({ where: { id: first.continuationId } });
  }
  async function generate() {
    await generatePersonal();
    return db.storyAiReusableResult.findFirstOrThrow({ where: { workId: work.id } });
  }
  async function addEvidence(result: Awaited<ReturnType<typeof generate>>, kind: 'quality' | 'moderation', overrides = {}) {
    return activation.evidence(owner.id, result.id, {
      originGeneratedSceneId: result.originGeneratedSceneId!, resultChecksum: result.resultChecksum!, kind,
      decision: 'allow', revision: 1, policyVersion: kind === 'quality' ? STORY_AI_QUALITY_RUBRIC : activationBody.moderationPolicyVersion,
      evaluatorVersion: kind === 'quality' ? STORY_AI_QUALITY_EVALUATOR : activationBody.moderationEvidenceVersion,
      evidenceHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(), qualityRubricConfirmed: true,
      ...overrides,
    });
  }
  async function approve(result: Awaited<ReturnType<typeof generate>>) {
    await addEvidence(result, 'moderation');
    await addEvidence(result, 'quality');
    return activation.promote(owner.id, result.id, result.resultChecksum!);
  }
  return { owner, reader, second, work, part, scene, choice, release, manuscript, consent, rights, rate,
    progresses, activation, approval, economics, provider, active, activationBody, context, request, generate, generatePersonal, addEvidence, approve };
}
