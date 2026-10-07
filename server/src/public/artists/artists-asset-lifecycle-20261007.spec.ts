import { ArtistsService } from './artists.service';

type Usage = 'cover' | 'thumb' | 'gallery';
const link = (usageType: Usage, metadata: unknown = {}, suffix = usageType as string) => ({
  usageType, isPrimary: usageType === 'cover', sortOrder: 0,
  asset: { id: `asset-${suffix}`, assetType: 'image', visibility: 'public', storageProvider: 'local',
    storageKey: `assets/characters/qa-lifecycle/${suffix}.png`, mimeType: 'image/png',
    width: 640, height: 480, metadata },
});
const artist = (artistAssets: ReturnType<typeof link>[], status = 'active', slug = 'qa-lifecycle') => ({
  id: `artist-${slug}`, slug, displayName: 'Synthetic lifecycle fixture', status, sortOrder: 0,
  launchedAt: null, publicProfile: null, visualProfile: null, contentProfile: null,
  artistAssets, createdAt: new Date('2026-10-07T00:00:00Z'), updatedAt: new Date('2026-10-07T00:00:00Z'),
});
const active = { lifecycle: { status: 'active' } };
const fixture = (rows: ReturnType<typeof artist>[]) => {
  const writes = jest.fn(() => { throw new Error('Focused lifecycle fixtures forbid database mutations'); });
  const prisma = {
    artist: {
      findMany: jest.fn(async (args: { where: { status: string | { in: string[] } } }) =>
        rows.filter(row => typeof args.where.status === 'string'
          ? row.status === args.where.status : args.where.status.in.includes(row.status))),
      findFirst: jest.fn(async (args: { where: { slug: string; status: string } }) =>
        rows.find(row => row.slug === args.where.slug && row.status === args.where.status) ?? null),
      create: writes, update: writes, delete: writes,
    },
    artistFollow: {
      count: jest.fn(async () => 0),
      findUnique: jest.fn(async () => { throw new Error('No viewer argument is supplied; authenticated follow lookup must not execute'); }),
      create: writes, update: writes, delete: writes,
    },
  };
  const config = { get: jest.fn((key: string) => key === 'FRONTEND_PUBLIC_BASE_URL' ? 'https://fixture.invalid/' : undefined) };
  const service = new ArtistsService(prisma as never, config as never);
  return { service, prisma, config, writes, rows };
};
const publicPair = async (metadata: unknown) => {
  const gallery = link('gallery', metadata);
  gallery.asset.metadata = metadata;
  const h = fixture([artist([link('cover'), gallery])]);
  const list = await h.service.findAll(), detail = await h.service.findBySlug('qa-lifecycle');
  expect(list).toHaveLength(1); expect(detail).not.toBeNull();
  return { ...h, list, detail: detail!, galleryList: list[0].assets.filter(asset => asset.usageType === 'gallery'),
    galleryDetail: detail!.assets.filter(asset => asset.usageType === 'gallery') };
};
const excludedGallery = async (metadata: unknown) => {
  const h = await publicPair(metadata);
  expect(h.galleryList).toEqual([]); expect(h.galleryDetail).toEqual([]);
  expect(h.list[0].coverImage?.id).toBe('asset-cover'); expect(h.detail.coverImage?.id).toBe('asset-cover');
};

describe('Public artist asset lifecycle boundary, actual service with synthetic Prisma', () => {
  it('preserves legacy lifecycle absence in list and detail without requiring new metadata', async () => {
    for (const metadata of [{}, { source: 'legacy' }, { uploadIntent: { status: 'uploaded' } }]) {
      const h = await publicPair(metadata);
      expect(h.galleryList.map(asset => asset.id)).toEqual(['asset-gallery']);
      expect(h.galleryDetail.map(asset => asset.id)).toEqual(['asset-gallery']);
    }
  });

  it('keeps the old top-level malformed-metadata behavior rather than inventing a new policy', async () => {
    for (const metadata of [null, undefined, [], 'metadata-string', false, 0]) {
      const h = await publicPair(metadata);
      expect(h.galleryList).toHaveLength(1); expect(h.galleryDetail).toHaveLength(1);
    }
    const malformed = [] as unknown[] & { lifecycle?: unknown };
    malformed.lifecycle = null;
    expect((await publicPair(malformed)).galleryDetail).toHaveLength(1);
  });

  it('accepts an explicit active lifecycle with absent or uploaded upload intent', async () => {
    for (const metadata of [active, { ...active, uploadIntent: { status: 'uploaded' } },
      { lifecycle: { status: 'active', additional: 'unchanged' }, uploadIntent: null }]) {
      const h = await publicPair(metadata);
      expect(h.galleryList).toHaveLength(1); expect(h.galleryDetail).toHaveLength(1);
    }
  });

  it('preserves uploadIntent gates for both legacy and active lifecycle metadata', async () => {
    for (const lifecycle of [{}, active]) {
      for (const uploadIntent of [{ status: 'pending' }, { status: 'uploading' }, { status: 'failed' },
        { status: '' }, { status: false }, {}]) await excludedGallery({ ...lifecycle, uploadIntent });
      for (const uploadIntent of [null, [], 'uploaded', false]) {
        expect((await publicPair({ ...lifecycle, uploadIntent })).galleryDetail).toHaveLength(1);
      }
    }
  });

  it('excludes archived and pending lifecycle galleries while keeping ready cover routes visible', async () => {
    for (const status of ['archived', 'pending']) await excludedGallery({ lifecycle: { status } });
  });

  it('holds own malformed lifecycle values null, undefined, array, string, boolean and number', async () => {
    for (const lifecycle of [null, undefined, [], ['active'], 'active', false, 0]) await excludedGallery({ lifecycle });
  });

  it('holds lifecycle objects with absent, null, false or non-string status', async () => {
    for (const lifecycle of [{}, { status: null }, { status: false }, { status: 1 }, { status: ['active'] }]) {
      await excludedGallery({ lifecycle });
    }
  });

  it('requires exact lowercase active, without case folding, whitespace trimming or empty status acceptance', async () => {
    for (const status of ['Active', 'ACTIVE', ' active', 'active ', '', ' ']) await excludedGallery({ lifecycle: { status } });
  });

  it('omits an active artist from public list when its only cover lifecycle is held', async () => {
    for (const lifecycle of [null, { status: 'pending' }, {}]) {
      const h = fixture([artist([link('cover', { lifecycle }), link('thumb', active), link('gallery', active)])]);
      expect(await h.service.findAll()).toEqual([]); expect(h.writes).not.toHaveBeenCalled();
    }
  });

  it('returns detail absence before follow reads when the cover lifecycle is held', async () => {
    for (const lifecycle of [null, { status: 'pending' }, {}]) {
      const h = fixture([artist([link('cover', { lifecycle }), link('thumb', active)])]);
      expect(await h.service.findBySlug('qa-lifecycle')).toBeNull();
      expect(h.prisma.artistFollow.count).not.toHaveBeenCalled();
      expect(h.prisma.artistFollow.findUnique).not.toHaveBeenCalled();
    }
  });

  it('keeps existing cover-as-thumbnail fallback when an explicit thumbnail lifecycle is held', async () => {
    const h = fixture([artist([link('cover', active), link('thumb', { lifecycle: { status: 'pending' } })])]);
    const list = await h.service.findAll(), detail = await h.service.findBySlug('qa-lifecycle');
    expect(list[0].thumbnailImage?.id).toBe('asset-cover'); expect(detail?.thumbnailImage?.id).toBe('asset-cover');
    expect(list[0].assets.map(asset => asset.id)).toEqual(['asset-cover']);
  });

  it('retains list and detail absence for missing cover assets, independently of lifecycle changes', async () => {
    for (const assets of [[], [link('thumb', active)]]) {
      const h = fixture([artist(assets)]);
      expect(await h.service.findAll()).toEqual([]); expect(await h.service.findBySlug('qa-lifecycle')).toBeNull();
      expect(h.prisma.artistFollow.count).not.toHaveBeenCalled();
    }
    expect(await fixture([]).service.findBySlug('missing-slug')).toBeNull();
  });

  it('preserves planned/candidate roadmap membership while excluding held cover URLs and gallery counts', async () => {
    const planned = artist([link('cover', active), link('gallery', active, 'ready'),
      link('gallery', { lifecycle: { status: 'pending' } }, 'held')], 'planned', 'qa-planned');
    const candidate = artist([link('cover', { lifecycle: null }), link('gallery', { lifecycle: {} })], 'candidate', 'qa-candidate');
    const h = fixture([planned, candidate]), roadmap = await h.service.findRoadmap();
    expect(roadmap.items.map(item => item.status)).toEqual(['planned', 'candidate']);
    expect(roadmap.items[0].galleryCount).toBe(1); expect(roadmap.items[0].coverUrl).toContain('/qa-lifecycle/cover.png');
    expect(roadmap.items[1]).toMatchObject({ coverUrl: null, thumbnailUrl: null, thumbUrl: null, galleryCount: 0 });
    expect(roadmap.policy.visibility).toBe('planned_candidate_only');
    expect(await h.service.findAll()).toEqual([]); expect(await h.service.findBySlug('qa-planned')).toBeNull();
    expect(await h.service.findBySlug('qa-candidate')).toBeNull(); expect(h.writes).not.toHaveBeenCalled();
  });

  it('does not mutate asset metadata, write Prisma data or promote anonymous viewer authority', async () => {
    const row = artist([link('cover', active), link('gallery', { lifecycle: { status: 'archived' }, uploadIntent: { status: 'uploaded' } })]);
    const before = JSON.stringify(row), h = fixture([row]);
    await h.service.findAll(); const detail = await h.service.findBySlug('qa-lifecycle');
    expect(JSON.stringify(row)).toBe(before); expect(h.writes).not.toHaveBeenCalled();
    expect(detail?.viewer).toEqual({ isAuthenticated: false, isFollowing: false, canFollow: false, canUnfollow: false });
    expect(h.prisma.artistFollow.count).toHaveBeenCalledTimes(1); expect(h.prisma.artistFollow.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.artist.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'active' },
      include: { artistAssets: { where: { asset: { visibility: 'public' } } } } });
  });
});
