import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryArtistParticipantService } from './story-artist-participant.service';

const ids = {
  artist: '11111111-1111-4111-8111-111111111111',
  progress: '22222222-2222-4222-8222-222222222222',
  participant: '33333333-3333-4333-8333-333333333333',
  profile: '44444444-4444-4444-8444-444444444444',
  reference: '55555555-5555-4555-8555-555555555555',
  thumbnail: '66666666-6666-4666-8666-666666666666',
};
const checksum = 'a'.repeat(64), changed = 'STORY_PARTICIPANT_IDENTITY_CHANGED';

function fixture(metadata: Prisma.JsonValue = { lifecycle: { status: 'active' } }, legacy = false) {
  const settings = {
    schemaVersion: 'creator-generation-profile-v1', kind: 'artist',
    sections: [
      { key: 'fixed_identity', decision: 'accepted', value: { hair: 'black', eyes: 'brown' }, evidence: [] },
      { key: 'adaptable_presentation', decision: 'accepted', value: { wardrobe: true }, evidence: [] },
    ],
  };
  const sourceFingerprint = 'b'.repeat(64);
  const approvedFingerprint = creatorGenerationProfileFingerprint(
    sourceFingerprint, normalizeCreatorGenerationProfile('artist', settings),
  );
  const profile = { id: ids.profile, artistId: ids.artist, status: 'approved', profileVersion: 2,
    reviewRevision: 3, sourceFingerprint, approvedFingerprint, approvedSettings: settings };
  const thumbnail = { usageType: 'thumb', isPrimary: true, sortOrder: 0,
    asset: { id: ids.thumbnail, storageKey: '/synthetic-projection-thumb.webp', mimeType: 'image/webp', metadata: {} } };
  const artist = { id: ids.artist, slug: 'synthetic-projection-artist', displayName: 'Synthetic Projection Artist',
    artistAssets: [thumbnail] };
  const referenceAssetIds = legacy ? [] : [ids.reference], referenceChecksums = legacy ? [] : [checksum];
  const identity = legacy ? null : { id: profile.id, profileVersion: profile.profileVersion,
    reviewRevision: profile.reviewRevision, sourceFingerprint, approvedFingerprint };
  const row = { id: ids.participant, progressId: ids.progress, artistId: ids.artist, artist,
    selectionSource: 'search', identityProfileId: legacy ? null : ids.profile,
    identityProfileVersion: legacy ? null : 2, identityReviewRevision: legacy ? null : 3,
    identitySourceFingerprint: legacy ? null : sourceFingerprint,
    identityApprovedFingerprint: legacy ? null : approvedFingerprint, referenceAssetIds, referenceChecksums,
    participantFingerprint: createHash('sha256').update(stableJson({ artistId: ids.artist,
      slug: artist.slug, displayName: artist.displayName, identity, referenceAssetIds, referenceChecksums })).digest('hex') };
  let current: typeof row | null = row, currentProfile: typeof profile | null = profile;
  const references = [{ assetId: ids.reference, asset: { checksum, metadata, storageProvider: 'local',
    storageKey: '/synthetic-projection-reference.webp', mimeType: 'image/webp', fileSizeBytes: BigInt(100) } }];
  const forbidWrite = () => jest.fn(async () => { throw new Error('Synthetic projection forbids writes'); });
  const writes = Array.from({ length: 7 }, forbidWrite);
  const prisma = {
    storyProgressArtistParticipant: { findUnique: jest.fn(async (_query: { where: { progressId: string } }) => current),
      create: writes[0], update: writes[1], delete: writes[2] },
    artistStoryIdentityProfile: { findFirst: jest.fn(async () => currentProfile), update: writes[3] },
    artistAsset: { findMany: jest.fn(async (_query: { where: { asset: { visibility: string; assetType?: string } } }) => references),
      update: writes[4] },
    auditEvent: { create: writes[5] },
    $executeRaw: writes[6], $queryRaw: jest.fn(async () => []),
  };
  const service = new StoryArtistParticipantService(prisma as never, { get: jest.fn(() => undefined) } as never);
  return { service, prisma, row, references, writes,
    dropProfile: () => { currentProfile = null; }, dropParticipant: () => { current = null; },
    project: () => service.projection(ids.progress), visual: () => service.visualReferences(ids.progress) };
}

async function outcome<T>(value: Promise<T>) {
  try { return { resolved: true, status: null, code: null, error: null, value: await value }; }
  catch (error) {
    const failure = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response = failure.getResponse?.() as { code?: string } | undefined;
    return { resolved: false, status: failure.getStatus?.() ?? null, code: response?.code ?? null, error, value: null };
  }
}

const observe = (value: unknown) => console.info(`PARTICIPANT_PROJECTION_OBSERVATION ${JSON.stringify(value)}`);
function unchanged(f: ReturnType<typeof fixture>, before: string) {
  expect(stableJson(f.row)).toBe(before);
  for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
  expect(f.prisma.storyProgressArtistParticipant.findUnique.mock.calls.every(([query]) =>
    (query as { where: { progressId: string } }).where.progressId === ids.progress)).toBe(true);
}

async function expectNotReady(f: ReturnType<typeof fixture>, reason: string) {
  const before = stableJson(f.row), visual = await outcome(f.visual()), projected = await outcome(f.project());
  observe({ reason, visual: { resolved: visual.resolved, status: visual.status, code: visual.code },
    projection: { resolved: projected.resolved, ready: projected.value?.visualIdentityReady ?? null },
    storedUnchanged: stableJson(f.row) === before, writes: f.writes.reduce((n, fn) => n + fn.mock.calls.length, 0) });
  unchanged(f, before);
  expect(visual).toMatchObject({ resolved: false, status: 409, code: changed });
  expect(projected).toMatchObject({ resolved: true, value: { artistId: ids.artist,
    slug: f.row.artist.slug, displayName: f.row.artist.displayName, selectionSource: 'search', locked: true,
    thumbnail: { assetId: ids.thumbnail }, visualIdentityReady: false } });
}

describe('participant stored projection readiness', () => {
  it('active and legacy-absent references retain truthful readiness, display IDs and the public reference query', async () => {
    for (const metadata of [{ lifecycle: { status: 'active' } }, {}] as Prisma.JsonValue[]) {
    const f = fixture(metadata), before = stableJson(f.row), visual = await f.visual(), projected = await f.project();
    expect(visual).toMatchObject({ artistId: ids.artist, participantFingerprint: f.row.participantFingerprint,
      references: [{ assetId: ids.reference, checksum, mimeType: 'image/webp', storageProvider: 'local' }] });
    expect(projected).toMatchObject({ artistId: ids.artist, slug: f.row.artist.slug,
      displayName: f.row.artist.displayName, selectionSource: 'search', locked: true,
      thumbnail: { assetId: ids.thumbnail }, visualIdentityReady: true });
    expect(Object.keys(projected!).sort()).toEqual(['artistId', 'displayName', 'locked', 'selectionSource',
      'slug', 'thumbnail', 'visualIdentityReady'].sort());
    expect(f.prisma.artistAsset.findMany.mock.calls.every(([query]) => query.where.asset.visibility === 'public')).toBe(true);
    expect(f.prisma.artistAsset.findMany.mock.calls.some(([query]) => query.where.asset.assetType === 'image')).toBe(true);
    unchanged(f, before);
    }
  });

  it('archived and pending references stop readiness while display identity and valid thumbnail survive', async () => {
    for (const status of ['archived', 'pending']) await expectNotReady(fixture({ lifecycle: { status } }), status);
  });

  it('a present null lifecycle fails closed instead of inheriting legacy absence', async () => {
    await expectNotReady(fixture({ lifecycle: null }), 'present null lifecycle');
  });

  it('a replacement checksum invalidates the saved reference without rewriting its pin', async () => {
    const f = fixture(); f.references[0].asset.checksum = 'c'.repeat(64);
    await expectNotReady(f, 'checksum replacement');
  });

  it('a now unsupported storage provider stops readiness even when pinned metadata still matches', async () => {
    const f = fixture(); f.references[0].asset.storageProvider = 'unsupported';
    await expectNotReady(f, 'provider change');
  });

  it('a now unsupported image format stops readiness even when pinned metadata still matches', async () => {
    const f = fixture(); f.references[0].asset.mimeType = 'application/pdf';
    await expectNotReady(f, 'format change');
  });

  it('a missing approved profile stops readiness without dropping the bound artist projection', async () => {
    const f = fixture(); f.dropProfile();
    await expectNotReady(f, 'missing approved profile');
  });

  it('a legacy profile-null participant remains locked but not visual-ready and needs no reference lookup', async () => {
    const f = fixture({}, true), before = stableJson(f.row);
    expect(await f.visual()).toEqual({ artistId: ids.artist,
      participantFingerprint: f.row.participantFingerprint, references: [] });
    expect(await f.project()).toMatchObject({ artistId: ids.artist, locked: true, visualIdentityReady: false });
    expect(f.prisma.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.artistAsset.findMany).not.toHaveBeenCalled();
    unchanged(f, before);
  });

  it('no participant remains null and never queries approval or references', async () => {
    const f = fixture(), before = stableJson(f.row); f.dropParticipant();
    expect(await f.project()).toBeNull(); expect(await f.visual()).toBeNull();
    expect(f.prisma.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.artistAsset.findMany).not.toHaveBeenCalled();
    unchanged(f, before);
  });

  it('unexpected profile and reference read errors propagate unchanged rather than turning into false readiness', async () => {
    const observed = [];
    for (const stage of ['profile', 'pinned-reference', 'visual-reference']) {
      const f = fixture(), before = stableJson(f.row), error = new Error('Synthetic unavailable read');
      if (stage === 'profile') f.prisma.artistStoryIdentityProfile.findFirst.mockRejectedValue(error);
      else f.prisma.artistAsset.findMany.mockImplementation(async query => {
        if (stage === 'pinned-reference' || query.where.asset.assetType === 'image') throw error;
        return f.references;
      });
      const projected = await outcome(f.project());
      observed.push({ stage, resolved: projected.resolved, exactError: projected.error === error });
      unchanged(f, before);
    }
    observe({ unexpectedReadErrors: observed });
    expect(observed).toEqual(['profile', 'pinned-reference', 'visual-reference'].map(stage =>
      ({ stage, resolved: false, exactError: true })));
  });

  it('non-identity conflicts propagate unchanged, including string responses and near-match codes', async () => {
    const errors = [
      new ConflictException({ code: 'STORY_PARTICIPANT_LOCKED' }),
      new ConflictException('Synthetic unexpected conflict'),
      new ConflictException({ code: 'STORY_PARTICIPANT_IDENTITY_CHANGED_EXTRA' }),
    ];
    const observed = [];
    for (const error of errors) {
      const f = fixture(), before = stableJson(f.row);
      f.prisma.artistStoryIdentityProfile.findFirst.mockRejectedValue(error);
      const projected = await outcome(f.project());
      observed.push({ resolved: projected.resolved, exactError: projected.error === error });
      unchanged(f, before);
    }
    observe({ nonIdentityConflicts: observed });
    expect(observed).toEqual(errors.map(() => ({ resolved: false, exactError: true })));
  });

  it('a disappeared reference stops readiness but does not erase display identity or stored IDs', async () => {
    const f = fixture(); f.references.length = 0;
    await expectNotReady(f, 'missing reference row');
  });
});
