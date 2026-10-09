import { ConfigService } from '@nestjs/config';
import { ArtistsService } from './artists.service';

const image = (id: string, usageType = 'cover', overrides: Record<string, unknown> = {}) => ({
  usageType, isPrimary: true, sortOrder: 0,
  asset: { id, assetType: 'image', mimeType: 'image/webp', storageProvider: 'local',
    storageKey: `assets/characters/display-image-fixture/${id}.webp`, width: 400, height: 600,
    metadata: {}, ...overrides },
});
function fixture(assets: ReturnType<typeof image>[], status = 'active') {
  const row = { id: 'display-image-fixture', slug: 'display-image-fixture', displayName: 'Synthetic artist',
    status, artistAssets: assets, publicProfile: null, visualProfile: null, contentProfile: null };
  const db = { artist: { findMany: jest.fn().mockResolvedValue([row]), findFirst: jest.fn().mockResolvedValue(row) },
    artistFollow: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() } };
  const config = { get: jest.fn().mockReturnValue('https://www.lumina-stage.com') };
  return { row, db, service: new ArtistsService(db as never, config as unknown as ConfigService) };
}

describe('ArtistsService display-image readiness', () => {
  it('does not publish a video-only cover as an image-ready artist', async () => {
    const { service, db } = fixture([image('video', 'cover', { assetType: 'video', mimeType: 'video/mp4' }), image('thumb', 'thumb')]);
    expect(await service.findAll()).toEqual([]);
    expect(await service.findBySlug('display-image-fixture')).toBeNull();
    expect(db.artistFollow.count).not.toHaveBeenCalled();
  });

  it.each(['video/mp4', 'text/html', '', 'image/', 'image/webp\n'])('skips invalid image MIME %j and chooses the next real cover', async mimeType => {
    const { service, row } = fixture([image('invalid', 'cover', { mimeType }), image('valid')]);
    const before = JSON.stringify(row);
    const [listed] = await service.findAll();
    const detailed = await service.findBySlug('display-image-fixture');
    expect(listed.coverImage?.id).toBe('valid');
    expect(detailed?.coverImage?.id).toBe('valid');
    expect(JSON.stringify(row)).toBe(before);
  });

  it('falls back only to the valid cover when the thumbnail is not an image', async () => {
    const { service } = fixture([image('cover'), image('invalid-thumb', 'thumb', { assetType: 'video', mimeType: 'video/mp4' })]);
    const [artist] = await service.findAll();
    expect(artist.coverImage?.id).toBe('cover');
    expect(artist.thumbnailImage?.id).toBe('cover');
    expect(artist.assets.map(asset => asset.id)).not.toContain('invalid-thumb');
  });

  it('counts roadmap gallery images without rejecting a separately attached video', async () => {
    const { service, row } = fixture([image('cover'), image('one', 'gallery'), image('two', 'gallery'),
      image('gallery-video', 'gallery', { assetType: 'video', mimeType: 'video/mp4' }),
      image('gallery-mismatch', 'gallery', { mimeType: 'video/mp4' }),
      image('clip', 'premium_video', { assetType: 'video', mimeType: 'video/mp4' })], 'planned');
    const before = JSON.stringify(row);
    const result = await service.findRoadmap();
    expect(result.items[0].galleryCount).toBe(2);
    expect(result.items[0].coverUrl).toContain('/cover.webp');
    expect(JSON.stringify(row)).toBe(before);
    row.status = 'active';
    const [artist] = await service.findAll();
    expect(artist.assets.map(asset => asset.id)).toEqual(['cover', 'one', 'two', 'clip']);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'IMAGE/WEBP'])('keeps existing valid image MIME %s', async mimeType => {
    const { service } = fixture([image('cover', 'cover', { mimeType })]);
    const [artist] = await service.findAll();
    expect(artist.coverImage?.id).toBe('cover');
    expect(artist.thumbnailImage?.id).toBe('cover');
  });

  it('keeps archived and pending-upload images excluded without editing their source metadata', async () => {
    const { service, row } = fixture([image('archived', 'cover', { metadata: { lifecycle: { status: 'archived' } } }),
      image('pending', 'cover', { metadata: { uploadIntent: { status: 'pending' } } }), image('valid')]);
    const before = JSON.stringify(row);
    const [artist] = await service.findAll();
    expect(artist.coverImage?.id).toBe('valid');
    expect(artist.assets.map(asset => asset.id)).toEqual(['valid']);
    expect(JSON.stringify(row)).toBe(before);
  });

  describe('independent MIME syntax regression', () => {
    it.each([
      'image/svg+xml; charset=utf-8',
      'image/svg+xml; charset="utf-8"',
      'image/svg+xml; charset="utf-8"; note="fixture; \\"quoted\\""',
      'image/x_fixture',
    ])('MIME review keeps legal image MIME %j in list detail and roadmap without rewriting source fields', async mimeType => {
      const links = [image('mime-cover', 'cover', { mimeType }), image('later-cover'),
        image('mime-thumb', 'thumb', { mimeType }), image('mime-gallery', 'gallery', { mimeType }),
        image('bare-gallery', 'gallery'),
        image('premium-clip', 'premium_video', { assetType: 'video', mimeType: 'video/mp4' }),
        image('short-clip', 'shortform', { assetType: 'video', mimeType: 'video/mp4' })];
      const active = fixture(links);
      const planned = fixture(links, 'planned');
      const before = JSON.stringify([active.row, planned.row]);
      const [listed] = await active.service.findAll();
      const detailed = await active.service.findBySlug('display-image-fixture');
      for (const artist of [listed, detailed]) {
        expect(artist?.coverImage?.id).toBe('mime-cover');
        expect(artist?.thumbnailImage?.id).toBe('mime-thumb');
        expect(artist?.assets.filter(asset => asset.id.startsWith('mime-')).map(asset => asset.mimeType))
          .toEqual([mimeType, mimeType, mimeType]);
        expect(artist?.assets.map(asset => asset.id))
          .toEqual(['mime-cover', 'later-cover', 'mime-thumb', 'mime-gallery', 'bare-gallery', 'premium-clip', 'short-clip']);
      }
      const roadmap = await planned.service.findRoadmap();
      expect(roadmap.items).toHaveLength(1);
      expect(roadmap.items[0].coverUrl).toContain('/mime-cover.webp');
      expect(roadmap.items[0].thumbUrl).toContain('/mime-thumb.webp');
      expect(roadmap.items[0].thumbnailUrl).toBe(roadmap.items[0].thumbUrl);
      expect(roadmap.items[0].galleryCount).toBe(2);
      expect(JSON.stringify([active.row, planned.row])).toBe(before);
    });

    it.each([
      ['malformed suffix', 'image/svg+xml;'],
      ['malformed suffix', 'image/svg+xml; charset'],
      ['malformed suffix', 'image/svg+xml; charset='],
      ['malformed suffix', 'image/svg+xml; charset="utf-8'],
      ['malformed suffix', 'image/svg+xml; charset=utf-8 garbage'],
      ['malformed suffix', 'image/svg+xml; charset=utf-8;'],
      ['control character', 'image/svg+xml; charset=utf-\u00008'],
      ['control character', 'image/svg+xml; note="fixture\rvalue"'],
      ['control character', 'image/svg+xml; note="fixture\nvalue"'],
      ['control character', 'image/svg+xml; note="fixture\u000bvalue"'],
      ['control character', 'image/svg+xml; note="fixture\u007fvalue"'],
      ['outer whitespace', ' image/svg+xml; charset=utf-8'],
      ['outer whitespace', 'image/svg+xml; charset=utf-8 '],
      ['outer whitespace', '\timage/x_fixture'],
      ['outer whitespace', 'image/x_fixture\t'],
      ['wildcard subtype', 'image/*'],
    ])('MIME review rejects %s MIME %j in image slots without mutation', async (_reason, mimeType) => {
      const links = [image('bad-cover', 'cover', { mimeType }), image('valid-cover'),
        image('bad-thumb', 'thumb', { mimeType }), image('bad-gallery', 'gallery', { mimeType }),
        image('valid-gallery', 'gallery')];
      const active = fixture(links);
      const planned = fixture(links, 'planned');
      const before = JSON.stringify([active.row, planned.row]);
      const [listed] = await active.service.findAll();
      const detailed = await active.service.findBySlug('display-image-fixture');
      for (const artist of [listed, detailed]) {
        expect(artist?.coverImage?.id).toBe('valid-cover');
        expect(artist?.thumbnailImage?.id).toBe('valid-cover');
        expect(artist?.assets.map(asset => asset.id)).toEqual(['valid-cover', 'valid-gallery']);
      }
      const roadmap = await planned.service.findRoadmap();
      expect(roadmap.items).toHaveLength(1);
      expect(roadmap.items[0].coverUrl).toContain('/valid-cover.webp');
      expect(roadmap.items[0].thumbUrl).toBe(roadmap.items[0].coverUrl);
      expect(roadmap.items[0].thumbnailUrl).toBe(roadmap.items[0].coverUrl);
      expect(roadmap.items[0].galleryCount).toBe(1);
      expect(JSON.stringify([active.row, planned.row])).toBe(before);
    });

    it.each(['cover', 'thumb', 'gallery'])('MIME review rejects video assetType with image MIME independently in %s', async usageType => {
      const links = [image('mismatch', usageType, { assetType: 'video', mimeType: 'image/webp' }),
        image('valid-cover'), image('valid-gallery', 'gallery')];
      const active = fixture(links);
      const planned = fixture(links, 'planned');
      const before = JSON.stringify([active.row, planned.row]);
      const [listed] = await active.service.findAll();
      const detailed = await active.service.findBySlug('display-image-fixture');
      for (const artist of [listed, detailed]) {
        expect(artist?.coverImage?.id).toBe('valid-cover');
        expect(artist?.thumbnailImage?.id).toBe('valid-cover');
        expect(artist?.assets.map(asset => asset.id)).toEqual(['valid-cover', 'valid-gallery']);
      }
      const roadmap = await planned.service.findRoadmap();
      expect(roadmap.items).toHaveLength(1);
      expect(roadmap.items[0].coverUrl).toContain('/valid-cover.webp');
      expect(roadmap.items[0].thumbUrl).toBe(roadmap.items[0].coverUrl);
      expect(roadmap.items[0].thumbnailUrl).toBe(roadmap.items[0].coverUrl);
      expect(roadmap.items[0].galleryCount).toBe(1);
      expect(JSON.stringify([active.row, planned.row])).toBe(before);
    });
  });
});
