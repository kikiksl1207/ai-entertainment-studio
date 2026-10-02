import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { buildStorySearchText, labelsForStoryHashtags } from './story-hashtag.policy';
import { sourceOf } from './story-studio-linear.service';
import { STORY_BRANCH_PREPARATION_PROMPT_VERSION } from './story-manuscript-version.store';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { MANUSCRIPT_FILE_LIMITS } from './story-manuscript-file.policy';
import { FixedRouteVisualBible } from './story-fixed-route-markdown.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';

export const PUBLICATION_AUTHOR_REVIEW_STATUS = 'awaiting_author_review';

export type PrivatePublicationSource = {
  storyKey: string; slug: string; title: string; summary: string; coverPath: string;
  sourceBindingSha256: string; hashtagKeys?: string[];
  contentRating?: 'adults_only'; catalogVisibility?: 'unlisted' | 'public_test';
  manuscript: { locale: string; contentHash: string; structuredBody: Prisma.JsonValue };
  parts: Array<{ partKey: string; title: string; beats: Array<{ text: string; sourceSceneKey?: string }> }>;
  prompts?: Array<{ sourceSceneKey: string; promptText: string; promptSha256: string }>;
  visualBible?: FixedRouteVisualBible; submissionId?: string;
};

export function assertPrivatePublicationSource(plan: PrivatePublicationSource) {
  const prepared = sourceOf(plan.manuscript);
  if (prepared.parts.length !== plan.parts.length || prepared.parts.some((part, index) =>
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(part.partKey) ||
    part.partKey !== plan.parts[index].partKey || part.title !== plan.parts[index].title)) {
    throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_SOURCE_MISMATCH' });
  }
  return prepared;
}

function visualSourceReferences(plan: PrivatePublicationSource, prepared: ReturnType<typeof sourceOf>,
  projection: ReturnType<typeof publicationReaderProjection>) {
  if (!plan.prompts?.length && !plan.visualBible) return {};
  const prompts = plan.prompts ?? [];
  const keys = new Set(plan.parts.flatMap(part => part.beats.map(beat => beat.sourceSceneKey).filter(Boolean)));
  if (new Set(prompts.map(prompt => prompt.sourceSceneKey)).size !== prompts.length ||
      prompts.some(prompt => !keys.has(prompt.sourceSceneKey) || typeof prompt.promptText !== 'string' ||
        !prompt.promptText.trim() || prompt.promptSha256 !== createHash('sha256')
          .update(prompt.promptText, 'utf8').digest('hex'))) {
    throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_VISUAL_SOURCE_INVALID' });
  }
  const reference = { contract: 'publication-visual-source-v1', sourceBindingSha256: plan.sourceBindingSha256,
    approvalState: 'reference_only', prompts: prompts.map(prompt => ({ ...prompt })),
    sceneBindings: publicationVisualSceneBindings(prepared.contentHash, prepared.parts, projection, plan.parts, prompts),
    ...(plan.visualBible ? { visualBible: plan.visualBible } : {}) };
  return { publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } };
}

export async function createPrivatePublicationIntake(tx: Prisma.TransactionClient,
  actorUserId: string, jobId: string, plan: PrivatePublicationSource) {
  const prepared = assertPrivatePublicationSource(plan);
  const projection = publicationReaderProjection(prepared.contentHash, prepared.parts, plan.parts);
  const structuredBody = { ...(plan.manuscript.structuredBody as Record<string, unknown>),
    publicationReaderProjection: projection,
    ...visualSourceReferences(plan, prepared, projection) };
  if (Buffer.byteLength(JSON.stringify(structuredBody), 'utf8') > MANUSCRIPT_FILE_LIMITS.storedBytes) {
    throw new ConflictException({ code: 'STORY_PUBLICATION_PRIVATE_MANUSCRIPT_TOO_LARGE' });
  }
  const workId = randomUUID();
  const manuscriptId = randomUUID();
  const hashtagKeys = plan.hashtagKeys ?? [];
  const hashtagLabels = labelsForStoryHashtags(hashtagKeys);
  await tx.storyWork.create({ data: {
    id: workId, ownerUserId: actorUserId, slug: plan.slug, status: 'draft',
    defaultLocale: 'ko', supportedLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
    title: { ko: plan.title }, summary: { ko: plan.summary }, authorDisplayName: '루미나',
    hashtagKeys, hashtagLabels,
    searchText: buildStorySearchText(plan.title, plan.summary, hashtagLabels, '루미나'),
    coverManifest: { publicAssetPath: plan.coverPath, altKey: `story.cover.${plan.storyKey}`,
      ...(plan.contentRating ? { contentRating: plan.contentRating } : {}),
      ...(plan.catalogVisibility ? { catalogVisibility: plan.catalogVisibility } : {}),
      privateIntake: { contract: 'publication-writer-intake-v1', jobId,
        sourceBindingSha256: plan.sourceBindingSha256, manuscriptHash: prepared.contentHash },
    }, priceLumina: 0, fixtureSource: false, customChoiceEnabled: false,
    activeReleaseId: null, publishedAt: null,
  } });
  await tx.storyManuscriptVersion.create({ data: {
    id: manuscriptId, workId, ownerUserId: actorUserId, version: 1, locale: prepared.locale,
    contentHash: prepared.contentHash, structuredBody: structuredBody as Prisma.InputJsonValue,
  } });
  await tx.storyBranchPreparationJob.createMany({ data: prepared.parts.map((part, partIndex) => ({
    workId, ownerUserId: actorUserId, manuscriptVersionId: manuscriptId, partIndex,
    expectedPartCount: prepared.parts.length, partKey: part.partKey,
    sourceHash: createHash('sha256').update(JSON.stringify(part)).digest('hex'),
    locale: prepared.locale, promptVersion: STORY_BRANCH_PREPARATION_PROMPT_VERSION,
    status: 'awaiting_author_consent',
  })) });
  if (plan.submissionId) {
    const submission = await tx.storyUploadSubmission.updateMany({ where: {
      id: plan.submissionId, userId: actorUserId, promotedWorkId: null,
    }, data: { status: 'author_review', promotedWorkId: workId } });
    if (submission.count !== 1) throw new ConflictException({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' });
  }
  await tx.storyPublicationImportJob.update({ where: { id: jobId }, data: {
    status: PUBLICATION_AUTHOR_REVIEW_STATUS, workId, releaseId: null, batchCursor: 0, errorCode: null,
  } });
  await tx.auditEvent.create({ data: { actorUserId, actorType: 'admin',
    action: 'story_publication.private_writer_intake', targetType: 'story_work', targetId: workId,
    metadata: { jobId, manuscriptVersionId: manuscriptId, manuscriptHash: prepared.contentHash,
      sourceBindingSha256: plan.sourceBindingSha256, partCount: prepared.parts.length,
      analysisStarted: false, choicesGenerated: false, published: false },
  } });
  return { workId, manuscriptId };
}

export function publicationAuthorReviewReceipt(jobId: string, workId: string,
  manuscriptVersionId: string, manuscriptHash: string, totalParts: number) {
  return { jobId, status: PUBLICATION_AUTHOR_REVIEW_STATUS, workId, releaseId: null,
    processedParts: 0, totalParts, errorCode: null, work: null,
    writerReview: { manuscriptVersionId, manuscriptHash, analysisStarted: false,
      nextAction: 'analyze_and_approve', studioUrl: '/creator-studio' },
  };
}
