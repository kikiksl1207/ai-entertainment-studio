import { playbackHash } from '../../ott-playback/ott-playback.contract';
import { LOCALES } from '../../ott-media/ott-media.contract';
import { OttMediaDelivery } from '../../ott-media/ott-media.delivery';
import { OttPublicService } from './ott-public.service';

const id = (value: string) => `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${value.repeat(3)}-${value.repeat(12)}`;
const workId = id('1'); const manifestId = id('2'); const ownerId = id('4'); const contractId = id('7');
const files = [id('5'), id('8')]; const versions = [id('6'), id('a')]; const rightsIds = [id('3'), id('9')];
const checksums = ['a'.repeat(64), 'b'.repeat(64)];
const localized = (prefix: string) => Object.fromEntries(LOCALES.map((locale) => [locale, `${prefix} ${locale}`]));
const release = { slug: 'author-cut', workId, manifestId, rightsContractVersionIds: rightsIds,
  status: 'published', source: 'authored_uploaded_clips', fixtureSource: false,
  rightsAuthorization: 'cleared_for_public_streaming', authorizedAt: '2026-09-20T00:00:00.000Z',
  publishedAt: '2026-09-21T00:00:00.000Z', title: localized('title'), synopsis: localized('synopsis'), creatorName: localized('creator') };
const graph = { entryNodeKey: 'intro', nodes: [
  { key: 'intro', clip: { fileId: files[0], mediaVersionId: versions[0], startMs: 0, endMs: 1000 },
    choices: [{ key: 'continue', label: localized('continue'), targetNodeKey: 'outro' }], ending: null, rejoin: false },
  { key: 'outro', clip: { fileId: files[1], mediaVersionId: versions[1], startMs: 0, endMs: 2000 },
    choices: [], ending: { key: 'end', label: localized('end') }, rejoin: false },
] };
const pins = files.map((fileId, index) => ({ fileId, mediaVersionId: versions[index], checksum: checksums[index],
  durationMs: index ? 2000 : 1000, confirmationHash: `confirmed-${index}` }));
const uploads = files.map((fileId, index) => ({ id: fileId, ownerId, versionId: versions[index], status: 'confirmed',
  intentKey: `test-${index}`, expiresAt: new Date(0),
  expected: { sha256: checksums[index], sizeBytes: 32, mimeType: 'video/mp4', declaredDurationMs: pins[index].durationMs, audioLocale: 'ko' },
  verified: { sha256: checksums[index], sizeBytes: 32, mimeType: 'video/mp4', durationMs: pins[index].durationMs },
  subtitles: LOCALES.map((locale) => ({ locale, cues: [{ startMs: 0, endMs: pins[index].durationMs, text: `cue ${index} ${locale}` }] })),
  confirmationHash: pins[index].confirmationHash, version: { workId }, revocation: null }));
const rights = versions.map((contentVersionId, index) => ({ id: rightsIds[index], contractId, contentVersionId,
  approvalState: 'approved_configuration', approvedByUserId: ownerId, media: ['ott_streaming'], regions: ['WORLDWIDE'],
  startsAt: new Date(0), endsAt: null, effectiveFrom: new Date(0), revision: index + 2 }));

function fixture() {
  let registry: string | undefined = JSON.stringify([release]);
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: ownerId }) },
    ottPlaybackManifest: { findFirst: jest.fn().mockResolvedValue({ id: manifestId, ownerId, workId, graph,
      checksum: playbackHash({ schema: 'ott-playback-v1', graph, pins }) }) },
    ottPlaybackAssetPin: { findMany: jest.fn().mockResolvedValue(pins) },
    ottMediaUpload: { findMany: jest.fn().mockResolvedValue(uploads) },
    contentRightsContractVersion: { findMany: jest.fn().mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(where.id ? rights : rights.map(({ id, contentVersionId }) => ({ id, contentVersionId })))) },
  };
  const media = {
    playbackUploadMetadata: jest.fn((upload: typeof uploads[number]) => ({ fileId: upload.id,
      mediaVersionId: upload.versionId, ...upload.verified, confirmationHash: upload.confirmationHash,
      subtitles: upload.subtitles })),
    deliverPinnedPublic: jest.fn().mockImplementation(async () => ({ sizeBytes: 32, close: jest.fn() })),
  };
  const config = { get: jest.fn((key: string) => key === 'OTT_PUBLIC_CATALOG_RELEASES' ? registry
    : key === 'OTT_MEDIA_DELIVERY_SECRET' ? 'test-only-secret'.repeat(4)
      : key === 'OTT_MEDIA_BROWSER_ORIGINS' ? '["https://lumina.example"]' : undefined) };
  const delivery = new OttMediaDelivery(config as never);
  const service = new OttPublicService(prisma as never, config as never, media as never, delivery);
  const setGraph = (next: typeof graph, nextPins = pins) => prisma.ottPlaybackManifest.findFirst.mockResolvedValue({
    id: manifestId, ownerId, workId, graph: next, checksum: playbackHash({ schema: 'ott-playback-v1', graph: next, pins: nextPins }),
  });
  return { prisma, media, service, delivery, setGraph,
    setRegistry: (value: string | undefined) => { registry = value; } };
}

describe('OttPublicService', () => {
  it('publishes a whole-file multi-node graph with each file\'s own subtitles and bytes', async () => {
    const f = fixture();
    expect((await f.service.list()).items[0]).toMatchObject({ slug: 'author-cut', viewing: { available: false } });
    expect(await f.service.findBySlug('author-cut')).toMatchObject({ viewing: { available: true,
      watchPath: '/api/v1/ott/author-cut/watch' } });
    const watch = await f.service.watch('author-cut', 'ko');
    expect(watch).toMatchObject({ entryNodeKey: 'intro', nodes: [
      { key: 'intro', clip: { startMs: 0, endMs: 1000 }, subtitles: [{ text: 'cue 0 ko' }] },
      { key: 'outro', clip: { startMs: 0, endMs: 2000 }, subtitles: [{ text: 'cue 1 ko' }] },
    ] });
    expect(JSON.stringify(watch)).not.toMatch(/fileId|versionId|ownerId|rightsContractVersionIds|__Secure-ott-public/i);
    expect(f.media.deliverPinnedPublic).toHaveBeenCalledTimes(6);
    expect(f.media.deliverPinnedPublic).toHaveBeenCalledWith(ownerId, files[0], versions[0], checksums[0]);
    expect(f.media.deliverPinnedPublic).toHaveBeenCalledWith(ownerId, files[1], versions[1], checksums[1]);
    expect(f.prisma.contentRightsContractVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ approvalState: 'approved_configuration', contentVersionId: { in: versions } }),
    }));
  });

  it('issues distinct node cookies and revalidates slug, node, manifest, file and checksum', async () => {
    const f = fixture();
    const intro = await f.service.browserSession('author-cut', 'intro');
    const outro = await f.service.browserSession('author-cut', 'outro');
    expect(intro?.cookie).toMatch(/Max-Age=60; HttpOnly; Secure; SameSite=Strict/);
    expect(intro?.path).toBe('/api/v1/ott/author-cut/nodes/intro/delivery');
    const introCookie = intro!.cookie.split(';')[0];
    const outroCookie = outro!.cookie.split(';')[0];
    await expect(f.service.deliver('author-cut', 'intro', introCookie)).resolves.toBeTruthy();
    await expect(f.service.deliver('author-cut', 'outro', outroCookie)).resolves.toBeTruthy();
    expect(f.media.deliverPinnedPublic).toHaveBeenLastCalledWith(ownerId, files[1], versions[1], checksums[1]);
    await expect(f.service.deliver('author-cut', 'outro', introCookie))
      .rejects.toMatchObject({ response: { code: 'OTT_TOKEN_INVALID' } });
    await expect(f.service.deliver('other-cut', 'intro', introCookie))
      .rejects.toMatchObject({ response: { code: 'OTT_TOKEN_INVALID' } });
    const wrongFile = f.delivery.issuePublicSession({ slug: 'author-cut', manifestId,
      nodeKey: 'intro', fileId: files[1], checksum: checksums[1] }).cookie.split(';')[0];
    await expect(f.service.deliver('author-cut', 'intro', wrongFile)).resolves.toBeNull();
    const wrongManifest = f.delivery.issuePublicSession({ slug: 'author-cut', manifestId: id('f'),
      nodeKey: 'intro', fileId: files[0], checksum: checksums[0] }).cookie.split(';')[0];
    await expect(f.service.deliver('author-cut', 'intro', wrongManifest)).resolves.toBeNull();
  });

  it('rejects tampered and expired cookies before persistence or bytes', async () => {
    const f = fixture();
    const cookie = (await f.service.browserSession('author-cut', 'intro'))!.cookie.split(';')[0];
    f.prisma.ottPlaybackManifest.findFirst.mockClear();
    f.media.deliverPinnedPublic.mockClear();
    await expect(f.service.deliver('author-cut', 'intro', `${cookie.slice(0, -1)}${cookie.endsWith('x') ? 'y' : 'x'}`))
      .rejects.toMatchObject({ response: { code: 'OTT_TOKEN_INVALID' } });
    expect(f.prisma.ottPlaybackManifest.findFirst).not.toHaveBeenCalled();
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(Date.now() + 61_000));
      await expect(f.service.deliver('author-cut', 'intro', cookie))
        .rejects.toMatchObject({ response: { code: 'OTT_TOKEN_INVALID' } });
      expect(f.media.deliverPinnedPublic).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it('rejects nonzero starts, short clips, and shared source files even when the manifest hash agrees', async () => {
    for (const clip of [
      { ...graph.nodes[1].clip!, startMs: 1 },
      { ...graph.nodes[1].clip!, endMs: 1999 },
      { ...graph.nodes[0].clip! },
    ]) {
      const f = fixture();
      f.setGraph({ ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], clip }] });
      await expect(f.service.watch('author-cut', 'ko')).resolves.toBeNull();
      expect(f.media.deliverPinnedPublic).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['missing pin', (f: ReturnType<typeof fixture>) => f.prisma.ottPlaybackAssetPin.findMany.mockResolvedValue([pins[0]])],
    ['changed pin', (f: ReturnType<typeof fixture>) => f.prisma.ottPlaybackAssetPin.findMany.mockResolvedValue([pins[0], { ...pins[1], checksum: 'c'.repeat(64) }])],
    ['missing upload', (f: ReturnType<typeof fixture>) => f.prisma.ottMediaUpload.findMany.mockResolvedValue([uploads[0]])],
    ['unconfirmed upload', (f: ReturnType<typeof fixture>) => f.prisma.ottMediaUpload.findMany.mockResolvedValue([uploads[0], { ...uploads[1], status: 'uploaded' }])],
    ['wrong media version', (f: ReturnType<typeof fixture>) => f.prisma.ottMediaUpload.findMany.mockResolvedValue([uploads[0], { ...uploads[1], versionId: id('c') }])],
    ['revoked upload', (f: ReturnType<typeof fixture>) => f.prisma.ottMediaUpload.findMany.mockResolvedValue([uploads[0], { ...uploads[1], revocation: {} }])],
    ['inactive owner', (f: ReturnType<typeof fixture>) => f.prisma.user.findFirst.mockResolvedValue(null)],
    ['missing rights', (f: ReturnType<typeof fixture>) => f.prisma.contentRightsContractVersion.findMany.mockResolvedValue([rights[0]])],
    ['regional rights', (f: ReturnType<typeof fixture>) => f.prisma.contentRightsContractVersion.findMany.mockResolvedValue([rights[0], { ...rights[1], regions: ['KR'] }])],
    ['rights without streaming', (f: ReturnType<typeof fixture>) => f.prisma.contentRightsContractVersion.findMany.mockResolvedValue([rights[0], { ...rights[1], media: ['download'] }])],
    ['expired rights', (f: ReturnType<typeof fixture>) => f.prisma.contentRightsContractVersion.findMany.mockResolvedValue([rights[0], { ...rights[1], endsAt: new Date(0) }])],
    ['draft rights', (f: ReturnType<typeof fixture>) => f.prisma.contentRightsContractVersion.findMany.mockResolvedValue([rights[0], { ...rights[1], approvalState: 'draft' }])],
  ])('fails closed for %s', async (_label, change) => {
    const f = fixture(); change(f);
    await expect(f.service.watch('author-cut', 'ko')).resolves.toBeNull();
    expect(f.media.deliverPinnedPublic).not.toHaveBeenCalled();
  });

  it('uses the latest approved rights per file version, ignoring a newer draft but blocking a newer approval', async () => {
    const f = fixture();
    const cookie = (await f.service.browserSession('author-cut', 'intro'))!.cookie.split(';')[0];
    const history = [
      ...rights.map(({ id, contentVersionId, approvalState, revision }) => ({ id, contentVersionId, approvalState, revision })),
      { id: id('b'), contentVersionId: versions[1], approvalState: 'draft', revision: 4 },
    ];
    f.prisma.contentRightsContractVersion.findMany.mockImplementation(({ where }: { where: { id?: unknown; approvalState?: string; contentVersionId?: { in: string[] } } }) =>
      Promise.resolve(where.id ? rights : history.filter((right) =>
        (!where.approvalState || right.approvalState === where.approvalState)
        && where.contentVersionId?.in.includes(right.contentVersionId)).sort((a, b) => b.revision - a.revision)));
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeTruthy();
    history.push({ id: id('c'), contentVersionId: versions[1], approvalState: 'approved_configuration', revision: 5 });
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeNull();
    history.pop();
    history.push({ id: id('d'), contentVersionId: id('e'), approvalState: 'approved_configuration', revision: 5 });
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeTruthy();
  });

  it('rechecks a rights window that expires while an issued node cookie is still valid', async () => {
    const f = fixture();
    const endsAt = new Date(Date.now() + 1000);
    f.prisma.contentRightsContractVersion.findMany.mockImplementation(({ where }: { where: { id?: unknown } }) =>
      Promise.resolve(where.id ? [rights[0], { ...rights[1], endsAt }]
        : rights.map(({ id, contentVersionId }) => ({ id, contentVersionId }))));
    const cookie = (await f.service.browserSession('author-cut', 'intro'))!.cookie.split(';')[0];
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date(endsAt.getTime() + 1));
      await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeNull();
    } finally { jest.useRealTimers(); }
  });

  it('blocks a prior cookie when another file loses bytes, an upload is cancelled, or publication is withdrawn', async () => {
    const f = fixture();
    const cookie = (await f.service.browserSession('author-cut', 'intro'))!.cookie.split(';')[0];
    f.media.deliverPinnedPublic.mockImplementation(async (_owner: string, fileId: string) => {
      if (fileId === files[1]) throw new Error('bytes missing');
      return { sizeBytes: 32, close: jest.fn() };
    });
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeNull();
    await expect(f.service.list()).resolves.toEqual({ items: [] });
    f.media.deliverPinnedPublic.mockImplementation(async () => ({ sizeBytes: 32, close: jest.fn() }));
    f.prisma.ottMediaUpload.findMany.mockResolvedValue([uploads[0], { ...uploads[1], revocation: {} }]);
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeNull();
    f.prisma.ottMediaUpload.findMany.mockResolvedValue(uploads);
    f.setRegistry(undefined);
    await expect(f.service.deliver('author-cut', 'intro', cookie)).resolves.toBeNull();
  });

  it('rejects unsupported locale, absent release, and incomplete rights allowlist', async () => {
    const f = fixture();
    await expect(f.service.watch('author-cut', 'fr')).resolves.toBeNull();
    f.setRegistry(undefined);
    await expect(f.service.watch('author-cut', 'ko')).resolves.toBeNull();
    f.setRegistry(JSON.stringify([{ ...release, rightsContractVersionIds: [rightsIds[0]] }]));
    await expect(f.service.watch('author-cut', 'ko')).resolves.toBeNull();
  });
});
