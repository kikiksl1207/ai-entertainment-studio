import { ConflictException } from '@nestjs/common';
import { PublicationChoiceProfileBinding } from './story-publication-choice-profile.service';
import { releaseChecksum } from './story-lifecycle.policy';

export type PublishedChoicePreparationContext = {
  version: 'published-choice-exact-scope-v1';
  workId: string;
  releaseId: string;
  parts: Array<{ partId: string; partKey: string; sceneId: string; title: string }>;
  sourceDigest: string;
  generationProfileBinding: PublicationChoiceProfileBinding | null;
};

type StoredContext = {
  workId: string; releaseId: string; firstPartPosition: number;
  preparationContext?: unknown; preparationContextSha256?: string | null;
};

export function readPublishedChoicePreparationContext(batch: StoredContext): PublishedChoicePreparationContext {
  const value = batch.preparationContext as Partial<PublishedChoicePreparationContext> | null;
  const nonempty = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128;
  const parts = value?.parts;
  if (!value || value.version !== 'published-choice-exact-scope-v1' || value.workId !== batch.workId ||
      value.releaseId !== batch.releaseId || !/^[a-f0-9]{64}$/.test(value.sourceDigest ?? '') ||
      !Array.isArray(parts) || !parts.length || parts.length > 8 ||
      parts.some(part => !part || !nonempty(part.partId) || !nonempty(part.sceneId) ||
        typeof part.title !== 'string' || !/^part-[1-9]\d*$/.test(part.partKey)) ||
      new Set(parts.map(part => part.partId)).size !== parts.length ||
      new Set(parts.map(part => part.sceneId)).size !== parts.length ||
      parts.some((part, index) => {
        const position = Number(part.partKey.slice(5));
        return !Number.isSafeInteger(position) || (index === 0 ? position !== batch.firstPartPosition
          : position <= Number(parts[index - 1].partKey.slice(5)));
      }) || value.generationProfileBinding === undefined ||
      (value.generationProfileBinding !== null && (typeof value.generationProfileBinding !== 'object' ||
        value.generationProfileBinding.workId !== batch.workId)) ||
      !batch.preparationContextSha256 || releaseChecksum(value) !== batch.preparationContextSha256) {
    throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED',
      message: 'The original batch scope is not verifiable; reconcile it without automatic retry' });
  }
  return value as PublishedChoicePreparationContext;
}

export function assertSamePublishedChoicePreparationContext(batch: StoredContext,
  current: PublishedChoicePreparationContext) {
  const saved = readPublishedChoicePreparationContext(batch);
  if (releaseChecksum(saved) !== releaseChecksum(current)) {
    throw new ConflictException({ code: 'STORY_CHOICE_PREPARATION_CONTEXT_CHANGED',
      message: 'The reviewed part list, source or author approval changed before retry' });
  }
}
