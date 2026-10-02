import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { createHash } from 'crypto';
import { StoryArtistParticipantService } from './story-artist-participant.service';

describe('StoryArtistParticipantService', () => {
  const likedArtistId = '11111111-1111-4111-8111-111111111111';
  const votedArtistId = '22222222-2222-4222-8222-222222222222';
  const searchedArtistId = '33333333-3333-4333-8333-333333333333';
  const workId = '44444444-4444-4444-8444-444444444444';
  const progressId = '55555555-5555-4555-8555-555555555555';
  const userId = '66666666-6666-4666-8666-666666666666';
  const checksum = 'a'.repeat(64);
  const sourceFingerprint = 'b'.repeat(64);
  const settings = {
    schemaVersion: 'creator-generation-profile-v1',
    kind: 'artist',
    sections: [
      { key: 'fixed_identity', decision: 'accepted', value: { hair: 'black', eyes: 'brown' }, evidence: [] },
      { key: 'adaptable_presentation', decision: 'accepted', value: { wardrobe: true }, evidence: [] },
    ],
  };
  const approvedFingerprint = creatorGenerationProfileFingerprint(
    sourceFingerprint,
    normalizeCreatorGenerationProfile('artist', settings),
  );
  const profile = {
    id: '77777777-7777-4777-8777-777777777777',
    profileVersion: 2,
    reviewRevision: 3,
    status: 'approved',
    sourceFingerprint,
    approvedFingerprint,
    approvedSettings: settings,
    referenceAssetIds: ['88888888-8888-4888-8888-888888888888'],
  };
  const artist = (id: string, displayName: string, withProfile = false) => ({
    id,
    slug: displayName.toLowerCase().replace(/\s/g, '-'),
    displayName,
    artistAssets: [{
      usageType: 'thumb', isPrimary: true, sortOrder: 0,
      asset: { id: '88888888-8888-4888-8888-888888888888', storageKey: '/artist.webp', mimeType: 'image/webp', metadata: {} },
    }],
    storyIdentityProfiles: withProfile ? [profile] : [],
  });
  const prisma = {
    storyWork: { findFirst: jest.fn() },
    artistBoostEvent: { findMany: jest.fn(), findFirst: jest.fn() },
    conceptVoteBallot: { findMany: jest.fn(), findFirst: jest.fn() },
    artist: { findMany: jest.fn(), findFirst: jest.fn() },
    storyProgressArtistParticipant: { findUnique: jest.fn(), create: jest.fn() },
    artistAsset: { findMany: jest.fn() },
    artistStoryIdentityProfile: { findFirst: jest.fn() },
    storyReaderProgress: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new StoryArtistParticipantService(
    prisma as never,
    { get: jest.fn(() => undefined) } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storyWork.findFirst.mockResolvedValue({ id: workId });
    prisma.artistAsset.findMany.mockResolvedValue([]);
    prisma.storyReaderProgress.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{
      status: 'active', currentBeatPosition: 0, currentGeneratedSceneId: null, pathSummary: [],
    }]);
  });

  it('combines liked and voted artists, while search can add any active artist', async () => {
    prisma.artistBoostEvent.findMany.mockResolvedValue([{ artistId: likedArtistId }]);
    prisma.conceptVoteBallot.findMany.mockResolvedValue([{ vote: { artistId: votedArtistId } }]);
    prisma.artist.findMany
      .mockResolvedValueOnce([artist(likedArtistId, 'Liked Artist'), artist(votedArtistId, 'Voted Artist')])
      .mockResolvedValueOnce([artist(searchedArtistId, 'Search Artist', true)]);
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    prisma.artistAsset.findMany.mockResolvedValue([{
      artistId: searchedArtistId, assetId: profile.referenceAssetIds[0], asset: {
        checksum, mimeType: 'image/webp', metadata: {}, storageProvider: 'local', fileSizeBytes: BigInt(100),
      },
    }]);

    const result = await service.candidates(userId, workId, { q: 'Search', take: 20 });

    expect(result.engaged.map((item) => [item.artistId, item.source])).toEqual([
      [likedArtistId, 'liked'],
      [votedArtistId, 'voted'],
    ]);
    expect(result.searchResults).toEqual([
      expect.objectContaining({ artistId: searchedArtistId, source: 'search', visualIdentityReady: true }),
    ]);
    expect(result.policy).toMatchObject({ maximumParticipants: 1, searchableArtists: 'all_active_registered_artists' });
  });

  it('does not enable a candidate when its approved reference asset is missing', async () => {
    prisma.artistBoostEvent.findMany.mockResolvedValue([]);
    prisma.conceptVoteBallot.findMany.mockResolvedValue([]);
    prisma.artist.findMany.mockResolvedValue([artist(searchedArtistId, 'Search Artist', true)]);
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);

    const result = await service.candidates(userId, workId, { q: 'Search', take: 20 });

    expect(result.searchResults).toEqual([
      expect.objectContaining({ artistId: searchedArtistId, visualIdentityReady: false }),
    ]);
    expect(prisma.artistAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ asset: { visibility: 'public' } }),
    }));
  });

  it('does not enable a candidate when its reference image was archived', async () => {
    prisma.artistBoostEvent.findMany.mockResolvedValue([]);
    prisma.conceptVoteBallot.findMany.mockResolvedValue([]);
    prisma.artist.findMany.mockResolvedValue([artist(searchedArtistId, 'Search Artist', true)]);
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    prisma.artistAsset.findMany.mockResolvedValue([{
      artistId: searchedArtistId, assetId: profile.referenceAssetIds[0], asset: {
        checksum, mimeType: 'image/webp', storageProvider: 'local', fileSizeBytes: BigInt(100),
        metadata: { lifecycle: { status: 'archived' } },
      },
    }]);

    const result = await service.candidates(userId, workId, { q: 'Search', take: 20 });

    expect(result.searchResults[0].visualIdentityReady).toBe(false);
  });

  it('pins the approved identity profile and exact reference checksum when progress starts', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    prisma.artist.findFirst.mockResolvedValue({
      id: searchedArtistId, slug: 'search-artist', displayName: 'Search Artist', storyIdentityProfiles: [profile],
    });
    prisma.artistBoostEvent.findFirst.mockResolvedValue(null);
    prisma.conceptVoteBallot.findFirst.mockResolvedValue(null);
    prisma.artistAsset.findMany.mockResolvedValue([{
      artistId: searchedArtistId, assetId: profile.referenceAssetIds[0], asset: {
        checksum, mimeType: 'image/webp', metadata: {}, storageProvider: 'local', fileSizeBytes: BigInt(100),
      },
    }]);
    prisma.storyProgressArtistParticipant.create.mockImplementation(({ data }) => ({ id: 'participant-id', ...data }));

    const result = await service.bind(prisma as never, { progressId, userId, workId, artistId: searchedArtistId });

    expect(result).toMatchObject({
      artistId: searchedArtistId,
      selectionSource: 'search',
      identityProfileId: profile.id,
      identityProfileVersion: 2,
      identityReviewRevision: 3,
      referenceAssetIds: profile.referenceAssetIds,
      referenceChecksums: [checksum],
    });
    expect(result.participantFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects participation when an artist has no approved visual identity', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    prisma.artist.findFirst.mockResolvedValue({
      id: searchedArtistId, slug: 'search-artist', displayName: 'Search Artist', storyIdentityProfiles: [],
    });
    prisma.artistBoostEvent.findFirst.mockResolvedValue(null);
    prisma.conceptVoteBallot.findFirst.mockResolvedValue(null);

    await expect(service.bind(prisma as never, { progressId, userId, workId, artistId: searchedArtistId }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_PARTICIPANT_IDENTITY_NOT_READY' }) });
    expect(prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  });

  it('rejects a different artist after the progress participant is fixed', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue({ artistId: likedArtistId });
    await expect(service.bind(prisma as never, {
      progressId, userId, workId, artistId: votedArtistId,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.artist.findFirst).not.toHaveBeenCalled();
  });

  it('locks and checks the exact owned progress before reading or saving participation', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.bind(prisma as never, { progressId, userId, workId, artistId: searchedArtistId }))
      .rejects.toBeInstanceOf(NotFoundException);
    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('FOR UPDATE');
    expect(query.sql).toContain('user_id ='); expect(query.sql).toContain('work_id =');
    expect(query.values).toEqual([progressId, userId, workId]);
    expect(prisma.storyProgressArtistParticipant.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  });

  it.each([
    { currentBeatPosition: 1 }, { currentGeneratedSceneId: likedArtistId }, { pathSummary: [{ sceneId: votedArtistId }] },
    { pathSummary: {} }, { status: 'completed' }, { status: 'awaiting_command' },
  ])('does not first-bind after reading or an unavailable progress state: %j', async changed => {
    prisma.$queryRaw.mockResolvedValue([{
      status: 'active', currentBeatPosition: 0, currentGeneratedSceneId: null, pathSummary: [], ...changed,
    }]);
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    await expect(service.bind(prisma as never, { progressId, userId, workId, artistId: searchedArtistId }))
      .rejects.toMatchObject({ response: { code: 'STORY_PARTICIPANT_LOCKED' } });
    expect(prisma.artist.findFirst).not.toHaveBeenCalled();
    expect(prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  });

  it('returns the same owned fixed participant after reading without changing its identity pin', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      status: 'active', currentBeatPosition: 2, currentGeneratedSceneId: null, pathSummary: [{ sceneId: votedArtistId }],
    }]);
    const fixed = { progressId, userId, workId, artistId: searchedArtistId, identityProfileId: profile.id };
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(fixed);
    expect(await service.bind(prisma as never, { progressId, userId, workId, artistId: searchedArtistId })).toBe(fixed);
    expect(prisma.artist.findFirst).not.toHaveBeenCalled();
    expect(prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  });

  it.each([null, { currentBeatPosition: 0 }, { currentBeatPosition: 1 }, { status: 'completed' }, { pathSummary: {} }])
    ('reports the same first-bind availability in candidates: %j', async changed => {
      prisma.artistBoostEvent.findMany.mockResolvedValue([]); prisma.conceptVoteBallot.findMany.mockResolvedValue([]);
      prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
      prisma.storyReaderProgress.findUnique.mockResolvedValue(changed === null ? null : {
        status: 'active', currentBeatPosition: 0, currentGeneratedSceneId: null, pathSummary: [], ...changed,
      });
      const result = await service.candidates(userId, workId, { take: 20 });
      expect(result.selectionLocked).toBe(changed !== null && !('currentBeatPosition' in changed && changed.currentBeatPosition === 0));
      expect(result.selectedArtistId).toBeNull();
      expect(prisma.storyReaderProgress.findUnique).toHaveBeenCalledWith({
        where: { userId_workId: { userId, workId } },
        select: { currentBeatPosition: true, currentGeneratedSceneId: true, pathSummary: true, status: true },
      });
    });

  const pinnedParticipant = () => ({
    id: 'participant-id', artistId: searchedArtistId, participantFingerprint: createHash('sha256').update(stableJson({
      artistId: searchedArtistId, slug: 'search-artist', displayName: 'Search Artist',
      identity: { id: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
        sourceFingerprint, approvedFingerprint }, referenceAssetIds: profile.referenceAssetIds, referenceChecksums: [checksum],
    })).digest('hex'),
    artist: { id: searchedArtistId, slug: 'search-artist', displayName: 'Search Artist' },
    identityProfileId: profile.id, identityProfileVersion: profile.profileVersion,
    identityReviewRevision: profile.reviewRevision, identitySourceFingerprint: sourceFingerprint,
    identityApprovedFingerprint: approvedFingerprint,
    referenceAssetIds: profile.referenceAssetIds, referenceChecksums: [checksum],
  });

  it('rejects a pinned identity whose reference image was archived later', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(pinnedParticipant());
    prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile);
    prisma.artistAsset.findMany.mockResolvedValue([{
      assetId: profile.referenceAssetIds[0], asset: {
        checksum, metadata: { lifecycle: { status: 'archived' } },
      },
    }]);

    await expect(service.pinnedContext(prisma as never, progressId))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_PARTICIPANT_IDENTITY_CHANGED' }) });
  });

  it.each(['displayName', 'slug', 'id'])('does not change the fixed artist snapshot after its %s changes', async field => {
    const participant = pinnedParticipant();
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(participant);
    prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile);
    prisma.artistAsset.findMany.mockResolvedValue([{
      assetId: profile.referenceAssetIds[0], asset: { checksum, metadata: {} },
    }]);
    await expect(service.pinnedContext(prisma as never, progressId)).resolves.toMatchObject({
      pin: { participantFingerprint: participant.participantFingerprint }, approved: { displayName: 'Search Artist' },
    });
    participant.artist[field as keyof typeof participant.artist] = 'A different artist';
    await expect(service.pinnedContext(prisma as never, progressId))
      .rejects.toMatchObject({ response: { code: 'STORY_PARTICIPANT_IDENTITY_CHANGED' } });
    expect(prisma.storyProgressArtistParticipant.create).not.toHaveBeenCalled();
  });

  it('rechecks archival when visual references are fetched after the pin check', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(pinnedParticipant());
    prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile);
    prisma.artistAsset.findMany
      .mockResolvedValueOnce([{
        assetId: profile.referenceAssetIds[0], asset: { checksum, metadata: {} },
      }])
      .mockResolvedValueOnce([{
        assetId: profile.referenceAssetIds[0], asset: {
          checksum, metadata: { lifecycle: { status: 'archived' } },
          storageProvider: 'local', storageKey: '/artist.webp', mimeType: 'image/webp', fileSizeBytes: BigInt(100),
        },
      }]);

    await expect(service.visualReferences(progressId))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_PARTICIPANT_IDENTITY_CHANGED' }) });
  });
});
