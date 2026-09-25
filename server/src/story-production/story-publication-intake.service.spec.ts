import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { INHERITOR_STORY } from './story-inheritor-publication.policy';

const inheritorSourceDir = process.env.INHERITOR_TEST_SOURCE_DIR;
const inheritorSourceTest = inheritorSourceDir &&
  existsSync(join(inheritorSourceDir, '01_전체_원고_통합본.md')) &&
  existsSync(join(inheritorSourceDir, '02_배경_이미지_지시_통합본.md')) ? it : it.skip;

describe('StoryPublicationIntakeService queue projection', () => {
  it('blocks adult-rated publication until verified age access is implemented', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    expect(() => (service as any).assertPublicRatingReady({ contentRating: 'adults_only' }))
      .toThrow('Adult identity verification must be enforced');
    expect(() => (service as any).assertPublicRatingReady({
      contentRating: 'adults_only', catalogVisibility: 'unlisted',
    })).not.toThrow();
    expect(() => (service as any).assertPublicRatingReady({})).not.toThrow();
  });

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
    const restored = (service as any).readStoredPlan(stored);
    expect(restored).toMatchObject({
      storyKey: 'norse',
      slug: 'norse-test',
      parts: [{ partKey: 'part-1' }],
    });
    const archived = (service as any).archivedManuscriptBody(
      restored,
      '00000000-0000-0000-0000-000000000001',
    );
    expect(archived).toMatchObject({
      format: 'approved-source-archive-reference-v1',
      archive: {
        storage: 'story_publication_source_chunks',
        bundleContract: 'norse-approved-bundle-v1',
      },
      materialized: { partCount: 1 },
    });
    expect(JSON.stringify(archived)).not.toContain('승인 원고 본문');
  });

  inheritorSourceTest('stores a compact plan and archives both approved source files exactly', () => {
    const service = new StoryPublicationIntakeService({} as never, {} as never);
    const manuscript = readFileSync(join(inheritorSourceDir!, '01_전체_원고_통합본.md'));
    const directions = readFileSync(join(inheritorSourceDir!, '02_배경_이미지_지시_통합본.md'));
    const buffers = new Map([
      [INHERITOR_STORY.manuscriptSha256, manuscript],
      [INHERITOR_STORY.promptSha256, directions],
    ]);
    const plan = (service as any).inheritorPlan(buffers);
    const stored = (service as any).storedPlan(plan);
    const restored = (service as any).readStoredPlan(stored);
    expect(restored.parts).toHaveLength(265);
    expect(restored.manuscript.structuredBody).toMatchObject({
      format: 'approved-source-plan-reference-v1',
    });
    expect(JSON.stringify(restored.manuscript.structuredBody)).not.toContain('스물일곱 번째 남자');
    const archived = (service as any).archivedManuscriptBody(restored, 'job-id');
    expect(archived.archive.bundleContract).toBe('inheritor-approved-bundle-v1');
    expect(archived.archive.publicationJobId).toBe('job-id');

    const chunks = (service as any).inheritorSourceChunks(buffers);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk: { totalChunks: number }) => chunk.totalChunks === chunks.length)).toBe(true);
    const bundle = brotliDecompressSync(Buffer.concat(chunks.map((chunk: { payload: Uint8Array }) => Buffer.from(chunk.payload))));
    const magic = Buffer.from('LUMINA_INHERITOR_BUNDLE_V1\0', 'ascii');
    expect(bundle.subarray(0, magic.length)).toEqual(magic);
    let cursor = magic.length;
    for (const original of [manuscript, directions]) {
      const length = bundle.readUInt32BE(cursor);
      cursor += 4;
      expect(length).toBe(original.length);
      const restoredHash = createHash('sha256').update(bundle.subarray(cursor, cursor + length)).digest('hex');
      const originalHash = createHash('sha256').update(original).digest('hex');
      expect(restoredHash).toBe(originalHash);
      cursor += length;
    }
    expect(cursor).toBe(bundle.length);
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
