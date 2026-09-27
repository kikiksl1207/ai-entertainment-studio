import { ConflictException } from '@nestjs/common';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
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
  };
  const service = new StoryArtistParticipantService(
    prisma as never,
    { get: jest.fn(() => undefined) } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storyWork.findFirst.mockResolvedValue({ id: workId });
  });

  it('combines liked and voted artists, while search can add any active artist', async () => {
    prisma.artistBoostEvent.findMany.mockResolvedValue([{ artistId: likedArtistId }]);
    prisma.conceptVoteBallot.findMany.mockResolvedValue([{ vote: { artistId: votedArtistId } }]);
    prisma.artist.findMany
      .mockResolvedValueOnce([artist(likedArtistId, 'Liked Artist'), artist(votedArtistId, 'Voted Artist')])
      .mockResolvedValueOnce([artist(searchedArtistId, 'Search Artist', true)]);
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);

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

  it('pins the approved identity profile and exact reference checksum when progress starts', async () => {
    prisma.storyProgressArtistParticipant.findUnique.mockResolvedValue(null);
    prisma.artist.findFirst.mockResolvedValue({
      id: searchedArtistId, slug: 'search-artist', displayName: 'Search Artist', storyIdentityProfiles: [profile],
    });
    prisma.artistBoostEvent.findFirst.mockResolvedValue(null);
    prisma.conceptVoteBallot.findFirst.mockResolvedValue(null);
    prisma.artistAsset.findMany.mockResolvedValue([{
      assetId: profile.referenceAssetIds[0], asset: { checksum, mimeType: 'image/webp' },
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
});
