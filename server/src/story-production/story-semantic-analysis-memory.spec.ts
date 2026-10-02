import 'reflect-metadata';
import { type StoryAnalysisJob } from '@prisma/client';
import { createHash, Hash } from 'crypto';
import { manuscriptContentHash, type ManuscriptPart } from './story-production.policy';
import { SemanticAnalysisService, streamedManuscriptHash } from './story-semantic-analysis.service';

describe('semantic analysis source hashing', () => {
  it('preserves long-manuscript checksums without serializing the whole body per hash write', async () => {
    const parts: ManuscriptPart[] = Array.from({ length: 265 }, (_, partIndex) => ({
      partKey: `part-${partIndex + 1}`, title: `Part ${partIndex + 1}`,
      paragraphs: Array.from({ length: 10 }, (_, paragraphIndex) => ({
        kind: 'paragraph' as const,
        text: `${'가'.repeat(paragraphIndex === 0 ? 4095 : 500)}😀 "\\\n" [event:${partIndex}-${paragraphIndex}]`,
      })),
    }));
    const rawText = parts.map(part => part.paragraphs.map(paragraph => paragraph.text).join('\n')).join('\n');
    const sourceSha256 = createHash('sha256').update(rawText).digest('hex');
    const identity = { identityVersion: 4, locale: 'ko', parts, sourceSha256 };
    const body = { parts, intake: { identityVersion: 4, source: { rawText, sha256: sourceSha256 } } };
    const contentHash = manuscriptContentHash(identity);
    const digest = manuscriptContentHash(body);
    const legacyHash = manuscriptContentHash({ parts });

    const update = jest.spyOn(Hash.prototype, 'update');
    try {
      expect(streamedManuscriptHash(identity)).toBe(contentHash);
      expect(streamedManuscriptHash(body)).toBe(digest);
      expect(streamedManuscriptHash({ parts })).toBe(legacyHash);
      expect(update.mock.calls.reduce((largest, [data]) => Math.max(largest, data.length), 0))
        .toBeLessThanOrEqual(24_576);
    } finally {
      update.mockRestore();
    }

    const findUniqueOrThrow = jest.fn().mockResolvedValue({ workId: 'work', ownerUserId: 'owner',
      contentHash, locale: 'ko', structuredBody: body });
    const service = new SemanticAnalysisService({ prisma: {
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work' }) },
      storyManuscriptVersion: { findUniqueOrThrow },
    } } as never, {} as never, {} as never);
    const job = { id: 'job', workId: 'work', actorUserId: 'owner', manuscriptVersionId: 'manuscript',
      sourceContentHash: contentHash, sourceLocale: 'ko', sourceDigest: digest, phase: 'planning' } as StoryAnalysisJob;
    const source = (service as unknown as { source: (job: StoryAnalysisJob) => Promise<ManuscriptPart[]> }).source.bind(service);
    expect(await source(job)).toBe(parts);
    expect(await source(job)).toBe(parts);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
});
