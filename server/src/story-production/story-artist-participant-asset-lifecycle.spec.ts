import 'reflect-metadata';
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
  work: '22222222-2222-4222-8222-222222222222',
  progress: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444',
  profile: '55555555-5555-4555-8555-555555555555',
  reference: '66666666-6666-4666-8666-666666666666',
  thumbnail: '77777777-7777-4777-8777-777777777777',
  participant: '88888888-8888-4888-8888-888888888888',
  secondReference: '99999999-9999-4999-8999-999999999999',
};
const checksum = 'a'.repeat(64);
const notReady = 'STORY_PARTICIPANT_IDENTITY_NOT_READY';
const changed = 'STORY_PARTICIPANT_IDENTITY_CHANGED';
const invalid: Array<{ name: string; lifecycle: Prisma.JsonValue }> = [
  { name: 'null', lifecycle: null },
  { name: 'string', lifecycle: 'active' },
  { name: 'array', lifecycle: [{ status: 'active' }] },
  { name: 'missing status', lifecycle: {} },
  { name: 'pending', lifecycle: { status: 'pending' } },
  { name: 'inactive', lifecycle: { status: 'inactive' } },
  { name: 'case mismatch', lifecycle: { status: 'Active' } },
  { name: 'archived', lifecycle: { status: 'archived' } },
];

function fixture(metadata: Prisma.JsonValue = {}) {
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
  const profile = {
    id: ids.profile, profileVersion: 2, reviewRevision: 3, status: 'approved',
    sourceFingerprint, approvedFingerprint, approvedSettings: settings, referenceAssetIds: [ids.reference],
  };
  const thumbnail = {
    usageType: 'thumb', isPrimary: true, sortOrder: 0,
    asset: { id: ids.thumbnail, storageKey: '/synthetic-participant-thumb.webp',
      mimeType: 'image/webp', metadata: {} as Prisma.JsonValue },
  };
  const artist = { id: ids.artist, slug: 'synthetic-participant', displayName: 'Synthetic Participant',
    artistAssets: [thumbnail], storyIdentityProfiles: [profile] };
  const references = [{ artistId: ids.artist, assetId: ids.reference, asset: {
    checksum, mimeType: 'image/webp', metadata, storageProvider: 'local',
    storageKey: '/synthetic-participant-reference.webp', fileSizeBytes: BigInt(100),
  } }];
  const progress = { status: 'active', currentBeatPosition: 0, currentGeneratedSceneId: null, pathSummary: [] };
  const saved: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  const artistSnapshot = { id: artist.id, slug: artist.slug, displayName: artist.displayName };
  const prisma = {
    storyWork: { findFirst: jest.fn(async () => ({ id: ids.work })) },
    artistBoostEvent: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    conceptVoteBallot: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    artist: { findMany: jest.fn(async () => [artist]), findFirst: jest.fn(async () => artist) },
    storyProgressArtistParticipant: {
      findUnique: jest.fn(async () => current),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: ids.participant, ...data };
        saved.push(row); current = { ...row, artist: artistSnapshot }; return row;
      }),
    },
    artistAsset: { findMany: jest.fn(async (_query: { where: { asset: { visibility: string } } }) => references) },
    artistStoryIdentityProfile: { findFirst: jest.fn(async () => profile) },
    storyReaderProgress: { findUnique: jest.fn(async () => progress) },
    $queryRaw: jest.fn(async (_query: Prisma.Sql) => [progress]),
  };
  const service = new StoryArtistParticipantService(prisma as never, { get: jest.fn(() => undefined) } as never);
  function installPin() {
    const referenceChecksums = profile.referenceAssetIds.map(id => references.find(row => row.assetId === id)!.asset.checksum);
    const identity = { id: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
      sourceFingerprint, approvedFingerprint };
    current = {
      id: ids.participant, progressId: ids.progress, userId: ids.user, workId: ids.work, artistId: ids.artist,
      artist: artistSnapshot, identityProfileId: profile.id, identityProfileVersion: profile.profileVersion,
      identityReviewRevision: profile.reviewRevision, identitySourceFingerprint: sourceFingerprint,
      identityApprovedFingerprint: approvedFingerprint, referenceAssetIds: [...profile.referenceAssetIds], referenceChecksums,
      participantFingerprint: createHash('sha256').update(stableJson({ artistId: ids.artist,
        slug: artist.slug, displayName: artist.displayName, identity,
        referenceAssetIds: profile.referenceAssetIds, referenceChecksums })).digest('hex'),
    };
  }
  return { service, prisma, profile, references, thumbnail, saved, progress, installPin,
    candidates: () => service.candidates(ids.user, ids.work, { q: 'Synthetic', take: 20 }),
    bind: () => service.bind(prisma as never, { progressId: ids.progress, userId: ids.user, workId: ids.work, artistId: ids.artist }),
    pinned: () => service.pinnedContext(prisma as never, ids.progress),
    visual: () => service.visualReferences(ids.progress),
  };
}

async function outcome<T>(promise: Promise<T>) {
  try { return { resolved: true, status: null, code: null, value: await promise }; }
  catch (error) {
    const failure = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response = failure.getResponse?.() as { code?: string } | undefined;
    return { resolved: false, status: failure.getStatus?.() ?? null, code: response?.code ?? null, value: null };
  }
}

const failure = (code: string) => ({ resolved: false, status: 409, code });
const observe = (value: unknown) => console.info(`PARTICIPANT_LIFECYCLE_OBSERVATION ${JSON.stringify(value)}`);

async function exercise(metadata: Prisma.JsonValue) {
  const f = fixture(metadata), candidates = await f.candidates();
  expect(f.prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  const bind = await outcome(f.bind()), bindWrites = f.saved.length;
  f.installPin();
  const pinned = await outcome(f.pinned()), visual = await outcome(f.visual());
  return { f, candidates, bind, pinned, visual, bindWrites };
}

describe('participant reference asset lifecycle', () => {
  it.each([
    { name: 'active', metadata: { lifecycle: { status: 'active' } } },
    { name: 'legacy absent', metadata: {} },
  ])('$name permits all four callers with real normalized approval settings and exact pins', async ({ name, metadata }) => {
    const result = await exercise(metadata);
    expect(result.candidates.searchResults[0]).toMatchObject({ artistId: ids.artist, visualIdentityReady: true,
      thumbnail: { assetId: ids.thumbnail } });
    expect(result.bind).toMatchObject({ resolved: true, value: { identityProfileId: ids.profile,
      identityProfileVersion: 2, identityReviewRevision: 3, referenceAssetIds: [ids.reference], referenceChecksums: [checksum] } });
    expect(result.bindWrites).toBe(1);
    expect(result.pinned).toMatchObject({ resolved: true, value: { approved: { visualIdentityReady: true } } });
    expect(result.visual).toMatchObject({ resolved: true, value: { references: [{ assetId: ids.reference,
      checksum, mimeType: 'image/webp', storageProvider: 'local', fileSizeBytes: 100 }] } });
    expect(result.f.prisma.$queryRaw.mock.calls[0][0].sql).toContain('FOR UPDATE');
    expect(result.f.prisma.artistAsset.findMany.mock.calls.every(([query]) => query.where.asset.visibility === 'public')).toBe(true);
    observe({ kind: name, candidateReady: true, bindWrites: result.bindWrites, pinnedReady: true, visualReferences: 1 });
  });

  it.each(invalid)('$name lifecycle denies readiness, first bind, pinned context and visual references', async ({ name, lifecycle }) => {
    const result = await exercise({ lifecycle });
    observe({ kind: name, candidateReady: result.candidates.searchResults[0].visualIdentityReady,
      bind: { resolved: result.bind.resolved, status: result.bind.status, code: result.bind.code, writes: result.bindWrites },
      pinned: { resolved: result.pinned.resolved, status: result.pinned.status, code: result.pinned.code },
      visual: { resolved: result.visual.resolved, status: result.visual.status, code: result.visual.code } });
    expect(result.candidates.searchResults[0].visualIdentityReady).toBe(false);
    expect(result.bind).toMatchObject(failure(notReady));
    expect(result.bindWrites).toBe(0);
    expect(result.pinned).toMatchObject(failure(changed));
    expect(result.visual).toMatchObject(failure(changed));
  });

  it('a separately eligible display thumbnail cannot grant reference readiness', async () => {
    const results = [];
    for (const { name, lifecycle } of invalid) {
      const f = fixture({ lifecycle }), row = (await f.candidates()).searchResults[0];
      results.push({ kind: name, thumbnail: row.thumbnail?.assetId, ready: row.visualIdentityReady, writes: f.saved.length });
    }
    observe({ method: 'eligible display thumbnail', results });
    expect(results).toEqual(invalid.map(({ name }) => ({ kind: name, thumbnail: ids.thumbnail, ready: false, writes: 0 })));
  });

  it('a lifecycle-ineligible display thumbnail stays null independently of valid reference readiness', async () => {
    const results = [];
    for (const { name, lifecycle } of invalid) {
      const f = fixture({ lifecycle: { status: 'active' } }); f.thumbnail.asset.metadata = { lifecycle };
      const row = (await f.candidates()).searchResults[0];
      results.push({ kind: name, thumbnail: row.thumbnail, ready: row.visualIdentityReady });
    }
    observe({ method: 'ineligible display thumbnail', results });
    expect(results).toEqual(invalid.map(({ name }) => ({ kind: name, thumbnail: null, ready: true })));
  });

  it('first bind requires every reference, even with one active reference and valid checksums', async () => {
    const results = [];
    for (const { name, lifecycle } of invalid) {
      const f = fixture({ lifecycle: { status: 'active' } });
      f.profile.referenceAssetIds.push(ids.secondReference);
      f.references.push({ artistId: ids.artist, assetId: ids.secondReference, asset: {
        ...f.references[0].asset, checksum: 'd'.repeat(64), metadata: { lifecycle },
      } });
      const result = await outcome(f.bind());
      results.push({ kind: name, resolved: result.resolved, status: result.status, code: result.code, writes: f.saved.length });
    }
    observe({ method: 'every reference on first bind', results });
    expect(results).toEqual(invalid.map(({ name }) => ({ kind: name, ...failure(notReady), writes: 0 })));
  });

  it('a later lifecycle change invalidates an actually bound pin without rewriting the saved participant', async () => {
    const results = [];
    for (const { name, lifecycle } of invalid) {
      const f = fixture({ lifecycle: { status: 'active' } }); await f.bind();
      const before = stableJson(f.saved);
      f.references[0].asset.metadata = { lifecycle };
      const result = await outcome(f.pinned());
      results.push({ kind: name, resolved: result.resolved, status: result.status, code: result.code,
        writes: f.saved.length, savedUnchanged: stableJson(f.saved) === before });
    }
    observe({ method: 'later pinned lifecycle', results });
    expect(results).toEqual(invalid.map(({ name }) => ({ kind: name, ...failure(changed), writes: 1, savedUnchanged: true })));
  });

  it('visual references recheck lifecycle on the second fetch after a valid pinned-context read', async () => {
    const results = [];
    for (const { name, lifecycle } of invalid) {
      const f = fixture({ lifecycle: { status: 'active' } }); f.installPin();
      const current = f.references.map(row => ({ ...row, asset: { ...row.asset, metadata: { lifecycle } } }));
      f.prisma.artistAsset.findMany.mockResolvedValueOnce(f.references).mockResolvedValueOnce(current);
      const result = await outcome(f.visual());
      results.push({ kind: name, resolved: result.resolved, status: result.status, code: result.code, writes: f.saved.length });
      expect(f.prisma.artistAsset.findMany).toHaveBeenCalledTimes(2);
    }
    observe({ method: 'second visual reference read', results, syntheticSchedule: true });
    expect(results).toEqual(invalid.map(({ name }) => ({ kind: name, ...failure(changed), writes: 0 })));
  });

  it('top-level non-object metadata retains the intentional lifecycle-absent legacy contract', async () => {
    for (const metadata of [null, 'synthetic legacy metadata', [], {}] as Prisma.JsonValue[]) {
      const result = await exercise(metadata);
      expect(result.candidates.searchResults[0].visualIdentityReady).toBe(true);
      expect(result.bind).toMatchObject({ resolved: true });
      expect(result.pinned).toMatchObject({ resolved: true });
      expect(result.visual).toMatchObject({ resolved: true });
      expect(result.bindWrites).toBe(1);
    }
  });
});
