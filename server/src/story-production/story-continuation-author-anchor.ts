import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { validAuthorFinalReviewProof } from './story-author-final-review.store';
import { authorReviewConflict } from './story-author-final-review.policy';
import { continuationHash, stableContinuationJson } from './story-continuation-context.policy';
import { assertStoryContinuationLengthBounds, type StoryContinuationLengthBounds } from './story-continuation-length.policy';
import { storyContinuationTextTokens } from './story-continuation-tokenizer';

export type StoryContinuationSegmentPolicy = {
  version: 'author-segment-v1';
  proofId: string;
  proofHash: string;
  releaseId: string;
  manuscriptVersionId: string;
  sourcePartId: string;
  sourceSceneId: string;
  narrativeHash: string;
  sourceLocale: string;
  targetLocale: string;
  length: StoryContinuationLengthBounds;
  model: string;
  referenceTokens: number;
  minGeneratedSegments: number;
  generatedSegmentIndex: number;
};

export function assertContinuationSegmentPolicy(value: unknown): asserts value is StoryContinuationSegmentPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) authorReviewConflict('AUTHOR_SEGMENT_POLICY_REQUIRED');
  const v = value as Record<string, unknown>;
  const ids = ['proofId', 'releaseId', 'manuscriptVersionId', 'sourcePartId', 'sourceSceneId'];
  if (v.version !== 'author-segment-v1' || Object.keys(v).length !== 15 ||
      ids.some(key => typeof v[key] !== 'string' || !/^[a-f0-9-]{36}$/i.test(v[key] as string)) ||
      [v.proofHash, v.narrativeHash].some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) ||
      v.sourceLocale !== v.targetLocale || typeof v.model !== 'string' ||
      !Number.isSafeInteger(v.referenceTokens) || Number(v.referenceTokens) < 1 || Number(v.referenceTokens) > 256_000 ||
      !Number.isSafeInteger(v.minGeneratedSegments) || Number(v.minGeneratedSegments) < 1 || Number(v.minGeneratedSegments) > 1000 ||
      !Number.isSafeInteger(v.generatedSegmentIndex) || Number(v.generatedSegmentIndex) < 1 || Number(v.generatedSegmentIndex) > 1_000_000) {
    authorReviewConflict('AUTHOR_SEGMENT_POLICY_INVALID');
  }
  assertStoryContinuationLengthBounds(v.length);
  if (v.length.locale !== v.targetLocale) authorReviewConflict('AUTHOR_SEGMENT_LOCALE_MISMATCH');
}

export async function resolveContinuationAuthorSegment(tx: Prisma.TransactionClient, input: {
  userId: string; workId: string; releaseId: string; manuscriptVersionId: string;
  progressId: string; sourcePartId: string; sourceSceneId?: string | null;
  sourceGeneratedSceneId?: string | null; locale: string; model: string;
}): Promise<StoryContinuationSegmentPolicy> {
  const { proof, snapshot } = await validAuthorFinalReviewProof(tx, { ...input, scope: 'anchor' });
  if (snapshot.sourceLocale !== input.locale || !snapshot.anchorPolicy ||
      snapshot.anchorPolicy.version !== 'author-branch-resolution-v1') authorReviewConflict('AUTHOR_SEGMENT_LOCALE_UNAVAILABLE');
  const reference = snapshot.parts.find(part => part.sourcePartId === input.sourcePartId);
  if (!reference?.length || (input.sourceSceneId && input.sourceSceneId !== reference.sourceSceneId)) {
    authorReviewConflict('AUTHOR_WHOLE_PART_REFERENCE_REQUIRED');
  }
  const scene = await tx.storyScene.findFirst({ where: { id: reference.sourceSceneId, partId: input.sourcePartId,
    status: 'published', fixtureSource: false } });
  const part = await tx.storyPart.findFirst({ where: { id: input.sourcePartId, workId: input.workId, status: 'published', fixtureSource: false } });
  if (!scene || !part) authorReviewConflict('AUTHOR_SEGMENT_REFERENCE_CHANGED');
  const beats = await tx.storyBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' }, take: 41,
    select: { id: true, position: true, sourceSceneKey: true, content: true } });
  const hash = createHash('sha256').update(JSON.stringify(beats.map(beat => ({ id: beat.id, position: beat.position,
    sourceSceneKey: beat.sourceSceneKey, content: beat.content })))).digest('hex');
  if (!beats.length || beats.length > 40 || hash !== reference.narrativeHash) authorReviewConflict('AUTHOR_SEGMENT_REFERENCE_CHANGED');
  const policy: StoryContinuationSegmentPolicy = {
    version: 'author-segment-v1', proofId: proof.id, proofHash: proof.proofHash, releaseId: proof.releaseId,
    manuscriptVersionId: proof.manuscriptVersionId, sourcePartId: part.id, sourceSceneId: scene.id,
    narrativeHash: reference.narrativeHash, sourceLocale: snapshot.sourceLocale, targetLocale: input.locale,
    length: reference.length, model: input.model,
    referenceTokens: storyContinuationTextTokens(input.model, JSON.stringify(beats.map(beat => beat.content))),
    minGeneratedSegments: snapshot.anchorPolicy.minGeneratedSegments, generatedSegmentIndex: 1,
  };
  if (input.sourceGeneratedSceneId) {
    const previous = await tx.storyAiGeneratedScene.findFirst({ where: { id: input.sourceGeneratedSceneId,
      userId: input.userId, workId: input.workId, progressId: input.progressId, releaseId: input.releaseId,
      sourcePartId: input.sourcePartId, status: 'ready' } });
    const parent = previous ? await tx.storyAiContinuation.findFirst({ where: { id: previous.continuationId,
      userId: input.userId, workId: input.workId, progressId: input.progressId, releaseId: input.releaseId,
      manuscriptVersionId: input.manuscriptVersionId, sourcePartId: input.sourcePartId, status: 'completed',
      resultGeneratedSceneId: previous.id } }) : null;
    const refs = parent?.contextReferences as Record<string, unknown> | undefined;
    const prior = refs?.segmentPolicy;
    assertContinuationSegmentPolicy(prior);
    if (refs?.segmentPolicyHash !== continuationHash(prior) ||
        stableContinuationJson({ ...prior, generatedSegmentIndex: 1 }) !== stableContinuationJson(policy)) {
      authorReviewConflict('AUTHOR_SEGMENT_INHERITANCE_CHANGED');
    }
    policy.generatedSegmentIndex = prior.generatedSegmentIndex + 1;
  }
  assertContinuationSegmentPolicy(policy);
  return policy;
}
