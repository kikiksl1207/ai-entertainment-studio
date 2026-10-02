import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { publicationVisualReferenceData, studioSceneVisualPrompt } from './story-approved-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { PreparedManuscript } from './story-manuscript-file.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';
import { readerPartText } from './story-studio-reader-text.policy';

export const STUDIO_MANUSCRIPT_VISUAL_PROPOSAL_VERSION = 'studio-manuscript-visual-proposal-v1';
export type StudioVisualGuidanceOrigin = 'imported_reference' | 'manuscript_proposal';
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function invalid(): never {
  throw new ConflictException({ code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' });
}

// This private view is reconstructed from verified reader text, never written into the manuscript.
export function studioManuscriptVisualReviewSource(body: Prisma.JsonValue, manuscriptHash: string, prepared: PreparedManuscript) {
  if (prepared.contentHash !== manuscriptHash || !/^[a-f0-9]{64}$/.test(manuscriptHash)) invalid();
  const imported = publicationVisualReferenceData(body, manuscriptHash);
  if (imported) return { body, reference: imported, guidanceOrigin: 'imported_reference' as StudioVisualGuidanceOrigin };
  const source = body as Record<string, unknown>;
  if (!source || typeof source !== 'object' || Array.isArray(source) || !prepared.parts.length ||
      prepared.parts.length > 2000 || releaseChecksum(source.parts) !== releaseChecksum(prepared.parts)) invalid();
  const seen = new Set<string>();
  const planned = prepared.parts.map(part => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(part.partKey) || seen.has(part.partKey)) invalid();
    seen.add(part.partKey);
    const text = prepared.readerPartTexts?.get(part.partKey) ?? readerPartText(part.paragraphs.map(row => row.text).join(''), part.title);
    if (!text.trim() || text.includes('\0')) invalid();
    return { partKey: part.partKey, title: part.title, beats: [{ text, sourceSceneKey: `${part.partKey}-main` }] };
  });
  const projection = publicationReaderProjection(manuscriptHash, prepared.parts, planned);
  const prompts = planned.map(part => {
    const promptText = studioSceneVisualPrompt(part.title, part.beats[0].text);
    return { sourceSceneKey: part.beats[0].sourceSceneKey, promptText, promptSha256: sha256(promptText) };
  });
  const sceneBindings = publicationVisualSceneBindings(manuscriptHash, prepared.parts, projection, planned, prompts);
  const proposal = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
    guidanceOrigin: 'manuscript_proposal', guidanceVersion: STUDIO_MANUSCRIPT_VISUAL_PROPOSAL_VERSION,
    sourceBindingSha256: releaseChecksum({ contract: STUDIO_MANUSCRIPT_VISUAL_PROPOSAL_VERSION, manuscriptHash, sceneBindings }),
    prompts, sceneBindings };
  const view = { ...source, publicationReaderProjection: projection,
    publicationVisualSource: { ...proposal, checksum: releaseChecksum(proposal) } } as Prisma.JsonValue;
  return { body: view, reference: publicationVisualReferenceData(view, manuscriptHash)!,
    guidanceOrigin: 'manuscript_proposal' as StudioVisualGuidanceOrigin };
}
