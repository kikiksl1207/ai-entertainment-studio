import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { StudioVisualReviewEntryDto } from './dto/story-studio-visual-review.dto';
import { publicationVisualReferenceData } from './story-approved-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { studioVisualReferenceReaderRange } from './story-studio-visual-reference.policy';

export function visualReviewConflict(code: string): never {
  throw new ConflictException({ code, message: 'Review the current manuscript and author settings before approving scene guidance' });
}

function invalid(): never {
  throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_ENTRIES_INVALID' });
}

export function studioVisualReviewEntries(body: unknown, manuscriptHash: string, sourceChecksum: string,
  input: StudioVisualReviewEntryDto[]) {
  const reference = publicationVisualReferenceData(body, manuscriptHash);
  if (!reference || reference.checksum !== sourceChecksum) visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
  if (!reference.bindings) visualReviewConflict('STUDIO_VISUAL_REVIEW_MAPPING_REQUIRED');
  if (!Array.isArray(input) || !input.length || input.length > 8) invalid();
  const prompts = (body as { publicationVisualSource: { prompts: Array<{ sourceSceneKey: string; promptSha256: string }> } })
    .publicationVisualSource.prompts;
  const seen = new Set<number>();
  const entries = input.map(row => {
    if (!row || !Number.isSafeInteger(row.referenceIndex) || row.referenceIndex < 0 || row.referenceIndex >= prompts.length ||
        seen.has(row.referenceIndex) || typeof row.promptText !== 'string' || !row.promptText.trim() ||
        row.promptText.length > 32000 || row.promptText.includes('\0')) invalid();
    const prompt = prompts[row.referenceIndex], binding = reference.bindings![row.referenceIndex];
    if (row.sourceSceneKey !== prompt.sourceSceneKey || row.originalPromptSha256 !== prompt.promptSha256) {
      visualReviewConflict('STUDIO_VISUAL_REVIEW_SOURCE_CHANGED');
    }
    if (!studioVisualReferenceReaderRange(body, binding).trim()) visualReviewConflict('STUDIO_VISUAL_REVIEW_PROSE_REQUIRED');
    seen.add(row.referenceIndex);
    return { referenceIndex: row.referenceIndex, sourceSceneKey: prompt.sourceSceneKey,
      originalPromptSha256: prompt.promptSha256, promptText: row.promptText,
      promptSha256: createHash('sha256').update(row.promptText, 'utf8').digest('hex'),
      partKey: binding.partKey, partTitle: binding.partTitle, bindingSha256: releaseChecksum(binding) };
  }).sort((a, b) => a.referenceIndex - b.referenceIndex);
  if (Buffer.byteLength(JSON.stringify(entries), 'utf8') > 256 * 1024) invalid();
  return entries;
}

export function studioVisualReviewBatchChecksum(identity: {
  ownerUserId: string; workId: string; manuscriptVersionId: string; manuscriptHash: string;
  sourceChecksum: string; analysisJobId: string; profilePinHash: string;
}, entries: ReturnType<typeof studioVisualReviewEntries>) {
  return releaseChecksum({ contract: 'story-visual-review-batch-v1', ...identity, entries });
}
