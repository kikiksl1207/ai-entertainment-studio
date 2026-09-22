import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { brotliCompressSync, gzipSync } from 'zlib';

describe('StoryPublicationIntakeService queue projection', () => {
  it.each([
    ['gzip', gzipSync],
    ['brotli', brotliCompressSync],
  ])('restores the exact approved source bytes from a %s bundle', (_, compress) => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const analysis = Buffer.from('{"analysis":true}');
    const sourceMap = Buffer.from('{"sourceMap":true}');
    const firstLength = Buffer.allocUnsafe(4);
    const secondLength = Buffer.allocUnsafe(4);
    firstLength.writeUInt32BE(analysis.length);
    secondLength.writeUInt32BE(sourceMap.length);
    const bundle = Buffer.concat([
      Buffer.from('LUMINA_NORSE_BUNDLE_V1\0', 'ascii'),
      firstLength,
      analysis,
      secondLength,
      sourceMap,
    ]);

    expect((service as any).unpackNorseBundle(compress(bundle))).toEqual([
      analysis,
      sourceMap,
    ]);
  });

  it('round-trips publication plans through compressed database storage', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const plan = {
      storyKey: 'norse',
      slug: 'norse-test',
      title: '북유럽 신화',
      summary: '검증용 요약',
      coverPath: '/cover.webp',
      manuscript: {
        locale: 'ko',
        contentHash: 'a'.repeat(64),
        legacyHash: 'c'.repeat(64),
        parts: [{ partKey: 'part-1', title: '첫 장', paragraphs: ['승인 원고 본문'] }],
        source: {
          kind: 'utf8_paste',
          rawText: '승인 원고 본문',
          sha256: 'a'.repeat(64),
          byteLength: 22,
        },
        paragraphCount: 1,
      },
      sourceBindingSha256: 'b'.repeat(64),
      parts: [{
        partKey: 'part-1',
        title: '첫 장',
        actNumber: 1,
        position: 1,
        beats: [{ text: '첫 장면', sourceSceneKey: 'scene-1' }],
        choices: [],
      }],
      prompts: [],
    };

    const stored = (service as any).storedPlan(plan);
    expect(stored.storageContract).toBe('story-publication-plan-br-base64-v1');
    expect(JSON.stringify(stored)).not.toContain('승인 원고 본문');
    expect((service as any).readStoredPlan(stored)).toMatchObject({
      storyKey: 'norse',
      slug: 'norse-test',
      parts: [{ partKey: 'part-1' }],
    });
  });

  it('detects only the exact approved source hashes and omits private storage keys', async () => {
    const prisma = {
      storyUploadSubmission: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'submission',
            title: 'Final Norse manuscript',
            status: 'received',
            originalLocale: 'ko',
            sourceClass: 'original',
            totalBytes: BigInt(27),
            createdAt: new Date('2026-09-22T00:00:00.000Z'),
            promotedWorkId: null,
            files: [
              {
                category: 'manuscript', position: 0, extension: '.json', fileSizeBytes: BigInt(11),
                checksumSha256: '74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8',
                storageKey: 'private/never-expose-this',
              },
              {
                category: 'manuscript', position: 1, extension: '.json', fileSizeBytes: BigInt(16),
                checksumSha256: 'f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5',
                storageKey: 'private/never-expose-this-either',
              },
            ],
          },
        ]),
      },
      storyWork: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    const result = await service.submissions();
    expect(result.items[0]).toMatchObject({
      id: 'submission',
      totalBytes: 27,
      detectedStoryKey: 'norse',
      promotedWorkId: null,
    });
    expect(JSON.stringify(result)).not.toContain('storageKey');
    expect(JSON.stringify(result)).not.toContain('never-expose');
  });
});
