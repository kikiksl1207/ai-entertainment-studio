import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ARTIST_PROFILE_SECTION_KEYS,
  CREATOR_GENERATION_PROFILE_SCHEMA,
} from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorStudioService } from './creator-studio.service';

const userId = '00000000-0000-4000-8000-000000000201';
const artistId = '00000000-0000-4000-8000-000000000202';
const assetId = '00000000-0000-4000-8000-000000000203';
const profileId = '00000000-0000-4000-8000-000000000204';

function settings(decision = 'accepted') {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'artist',
    sections: ARTIST_PROFILE_SECTION_KEYS.map((key) => ({
      key,
      decision,
      value: { summary: key },
      evidence: [],
    })),
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    artistId,
    sourceFingerprint: 'a'.repeat(64),
    referenceAssetIds: [assetId],
    profileVersion: 1,
    reviewRevision: 0,
    status: 'needs_review',
    draftSettings: settings(),
    draftFingerprint: 'b'.repeat(64),
    approvedSettings: null,
    approvedFingerprint: null,
    approvedByUserId: null,
    approvedAt: null,
    analysisErrorCode: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

function fixture() {
  const tx = {
    artistStoryIdentityProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = {
    artistOperator: { findFirst: jest.fn().mockResolvedValue({ id: 'operator' }) },
    artist: { findUnique: jest.fn().mockResolvedValue({
      id: artistId,
      displayName: 'Synthetic Artist',
      visualProfile: { visualKeywords: ['clean'], styleNotes: null, primaryColor: null, secondaryColor: null },
      artistAssets: [{
        assetId,
        usageType: 'cover',
        asset: {
          assetType: 'image',
          mimeType: 'image/webp',
          checksum: 'c'.repeat(64),
          storageKey: 'artists/synthetic/reference.webp',
          metadata: { lifecycle: { status: 'active' } },
        },
      }],
    }) },
    artistStoryIdentityProfile: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return {
    service: new CreatorStudioService(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
    ),
    prisma,
    tx,
  };
}

describe('CreatorStudioService story identity profile', () => {
  it('binds an artist draft to owned active image checksums', async () => {
    const f = fixture();
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile({ ...data }));

    const result = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId],
      settings: settings(),
    } as never);

    expect(result.profile).toMatchObject({
      status: 'needs_review',
      referenceAssetIds: [assetId],
      reviewRequired: true,
    });
    expect(result.profile.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'artist_story_identity_profile.draft_saved',
        metadata: expect.objectContaining({ referenceChecksums: ['c'.repeat(64)] }),
      }),
    }));
  });

  it('rejects a reference image that is not attached to the artist', async () => {
    const f = fixture();
    f.prisma.artist.findUnique.mockResolvedValue({
      id: artistId,
      displayName: 'Synthetic Artist',
      visualProfile: null,
      artistAssets: [],
    });

    await expect(f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId],
      settings: settings(),
    } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.artistStoryIdentityProfile.create).not.toHaveBeenCalled();
  });

  it('blocks approval after the reference source fingerprint changes', async () => {
    const f = fixture();
    f.prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile({
      sourceFingerprint: 'f'.repeat(64),
      draftFingerprint: 'b'.repeat(64),
    }));

    await expect(f.service.approveArtistStoryIdentityProfile(userId, artistId, {
      expectedDraftFingerprint: 'b'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates an AI review draft from owned public reference images', async () => {
    const f = fixture();
    const analysis = { analyze: jest.fn().mockResolvedValue(settings('proposed')) };
    const configService = {
      get: jest.fn((key: string) => key === 'OBJECT_STORAGE_PUBLIC_BASE_URL' ? 'https://assets.example.com' : undefined),
    } as unknown as ConfigService;
    const service = new CreatorStudioService(
      f.prisma as unknown as PrismaService,
      configService,
      analysis as never,
    );
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile({ ...data }));

    const result = await service.createArtistStoryIdentityDraft(userId, artistId, {
      referenceAssetIds: [assetId],
    });

    expect(analysis.analyze).toHaveBeenCalledWith(expect.objectContaining({
      artistId,
      references: [expect.objectContaining({
        assetId,
        imageUrl: 'https://assets.example.com/artists/synthetic/reference.webp',
      })],
    }));
    expect(result.profile).toMatchObject({ status: 'needs_review', reviewRequired: true });
  });
});
