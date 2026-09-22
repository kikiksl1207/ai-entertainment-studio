import { OttPublicService } from './ott-public.service';

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const workId = id('1'); const manifestId = id('2'); const rightsId = id('3'); const ownerId = id('4'); const fileId = id('5'); const versionId = id('6');
const localized = (prefix: string) => ({ ko: `${prefix} ko`, en: `${prefix} en`, ja: `${prefix} ja`, 'zh-Hans': `${prefix} zh`, 'zh-Hant': `${prefix} zht` });
const registry = JSON.stringify([{ slug: 'author-cut', workId, manifestId, rightsContractVersionIds: [rightsId],
  status: 'published', source: 'authored_uploaded_clips', fixtureSource: false,
  rightsAuthorization: 'cleared_for_public_streaming', authorizedAt: '2026-09-20T00:00:00.000Z',
  publishedAt: '2026-09-21T00:00:00.000Z', title: localized('title'), synopsis: localized('synopsis'), creatorName: localized('creator') }]);

function fixture() {
  const prisma = {
    ottPlaybackManifest: { findFirst: jest.fn().mockResolvedValue({ id: manifestId, ownerId, workId, graph: { entryNodeKey: 'intro', nodes: [{ key: 'intro', clip: { fileId, mediaVersionId: versionId, startMs: 0, endMs: 1000 }, choices: [], ending: { key: 'end', label: localized('end') }, rejoin: false }] } }) },
    ottPlaybackAssetPin: { findMany: jest.fn().mockResolvedValue([{ fileId, mediaVersionId: versionId, confirmationHash: 'confirmed' }]) },
    ottMediaUpload: { findMany: jest.fn().mockResolvedValue([{ id: fileId, versionId, confirmationHash: 'confirmed', verified: { durationMs: 1000 }, revocation: null }]) },
    contentRightsContractVersion: { findMany: jest.fn().mockResolvedValue([{ contentVersionId: versionId, media: ['ott_streaming'], startsAt: new Date(0), endsAt: null, effectiveFrom: new Date(0) }]) },
  };
  const config = { get: jest.fn().mockReturnValue(registry) };
  return { prisma, service: new OttPublicService(prisma as never, config as never) };
}

describe('OttPublicService', () => {
  it('returns an eligible authored release as metadata only', async () => {
    const { prisma, service } = fixture();
    const result = await service.list();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ slug: 'author-cut', viewing: { available: false } });
    expect(prisma.contentRightsContractVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: [rightsId] },
        contentVersionId: { in: [versionId] },
      }),
    }));
  });

  it('omits a release when rights, pins, or confirmed media no longer pass', async () => {
    const { prisma, service } = fixture();
    prisma.contentRightsContractVersion.findMany.mockResolvedValue([]);
    await expect(service.list()).resolves.toEqual({ items: [] });
  });

  it('omits a release when the approved rights version covers a different media version', async () => {
    const { prisma, service } = fixture();
    prisma.contentRightsContractVersion.findMany.mockResolvedValue([{
      contentVersionId: manifestId, media: ['ott_streaming'], startsAt: new Date(0), endsAt: null, effectiveFrom: new Date(0),
    }]);
    await expect(service.list()).resolves.toEqual({ items: [] });
  });
});
