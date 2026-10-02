import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  Object.assign(tx, {
    artist: prisma.artist,
    $queryRaw: jest.fn().mockResolvedValue([{ id: artistId }]),
  });
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
        actorUserId: userId,
        actorType: 'user',
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
    f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile({
      sourceFingerprint: 'f'.repeat(64), draftFingerprint: 'b'.repeat(64),
    }));

    await expect(f.service.approveArtistStoryIdentityProfile(userId, artistId, {
      expectedDraftFingerprint: 'b'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.artistStoryIdentityProfile.updateMany).not.toHaveBeenCalled();
  });

  it('audits both the confirmed identity draft and approval as an authenticated user', async () => {
    const f = fixture();
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile({ ...data }));
    const draft = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId], settings: settings(),
    } as never);
    const current = profile({ sourceFingerprint: draft.profile.sourceFingerprint,
      draftFingerprint: draft.profile.draftFingerprint, draftSettings: draft.profile.draftSettings });
    f.prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(current);
    f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValue(current);
    f.tx.artistStoryIdentityProfile.updateMany.mockImplementation(({ data }) => {
      Object.assign(current, data); return { count: 1 };
    });
    f.tx.artistStoryIdentityProfile.findUniqueOrThrow.mockImplementation(() => current);
    expect((await f.service.approveArtistStoryIdentityProfile(userId, artistId, {
      expectedDraftFingerprint: draft.profile.draftFingerprint!,
    })).profile).toMatchObject({ status: 'approved', reviewRequired: false });
    expect(f.tx.auditEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorUserId: userId, actorType: 'user', action: 'artist_story_identity_profile.approved', targetId: profileId,
    }) }));
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

  it('selects the latest identity only inside the locked save transaction', async () => {
    const f = fixture();
    const raw = (f.tx as unknown as { $queryRaw: jest.Mock }).$queryRaw;
    const approved = profile({ status: 'approved', profileVersion: 7 });
    f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValue(approved);
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile(data));
    const result = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId], settings: settings(),
    } as never);
    expect(result.profile.profileVersion).toBe(8);
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted', timeout: 10_000,
    });
    expect(f.prisma.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(raw.mock.calls.map(call => call[0].join(' '))).toEqual([
      expect.stringMatching(/artists.*FOR UPDATE/s),
      expect.stringMatching(/artist_operators.*FOR SHARE/s),
      expect.stringMatching(/artist_story_identity_profiles.*LIMIT 1 FOR UPDATE/s),
      expect.stringMatching(/artist_visual_profiles.*FOR SHARE/s),
      expect.stringMatching(/assets.*FOR SHARE/s),
      expect.stringMatching(/artist_assets.*FOR SHARE/s),
    ]);
    expect(raw.mock.invocationCallOrder[2]).toBeLessThan(
      f.tx.artistStoryIdentityProfile.findFirst.mock.invocationCallOrder[0]);
  });

  it('rejects an old approval even if an outside latest query would return it', async () => {
    const f = fixture();
    f.prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile());
    f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile({ draftFingerprint: 'f'.repeat(64) }));
    await expect(f.service.approveArtistStoryIdentityProfile(userId, artistId, {
      expectedDraftFingerprint: 'b'.repeat(64),
    })).rejects.toMatchObject({ response: { code: 'GENERATION_PROFILE_DRAFT_CHANGED' } });
    expect(f.prisma.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(f.tx.artistStoryIdentityProfile.updateMany).not.toHaveBeenCalled();
  });

  it.each(['draft', 'approval'] as const)('rechecks revoked operator access inside %s persistence', async action => {
    const f = fixture();
    const raw = (f.tx as unknown as { $queryRaw: jest.Mock }).$queryRaw;
    raw.mockResolvedValueOnce([{ id: artistId }]).mockResolvedValueOnce([]);
    const operation = action === 'draft'
      ? f.service.updateArtistStoryIdentityProfile(userId, artistId, {
        referenceAssetIds: [assetId], settings: settings(),
      } as never)
      : f.service.approveArtistStoryIdentityProfile(userId, artistId, { expectedDraftFingerprint: 'b'.repeat(64) });
    await expect(operation).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a deleted artist inside persistence without saving a draft', async () => {
    const f = fixture();
    (f.tx as unknown as { $queryRaw: jest.Mock }).$queryRaw.mockResolvedValue([]);
    await expect(f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId], settings: settings(),
    } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed reference UUID before casting a source lock', async () => {
    const f = fixture();
    await expect(f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: ['-'.repeat(36)], settings: settings(),
    } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect((f.tx as unknown as { $queryRaw: jest.Mock }).$queryRaw).toHaveBeenCalledTimes(3);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a changed analysis source inside persistence before writing', async () => {
    const f = fixture();
    await expect(f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId], settings: settings(),
    } as never, 'f'.repeat(64))).rejects.toMatchObject({ response: { code: 'ARTIST_IDENTITY_SOURCE_CHANGED' } });
    expect(f.tx.artistStoryIdentityProfile.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not substitute two usages of one image for a missing second reference', async () => {
    const f = fixture();
    const source = await f.prisma.artist.findUnique();
    const row = source.artistAssets[0];
    f.prisma.artist.findUnique.mockResolvedValue({ ...source, artistAssets: [row, { ...row, usageType: 'thumb' }] });
    await expect(f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId, '00000000-0000-4000-8000-000000000209'], settings: settings(),
    } as never)).rejects.toMatchObject({ response: { code: 'ARTIST_IDENTITY_REFERENCE_NOT_OWNED' } });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('chooses one stable cover reference when an image has multiple usage links', async () => {
    const f = fixture();
    const source = await f.prisma.artist.findUnique();
    const actualAssetId = 'abcdefab-cdef-4abc-8abc-abcdefabcdef';
    const row = { ...source.artistAssets[0], assetId: actualAssetId };
    f.prisma.artist.findUnique.mockResolvedValue({ ...source, artistAssets: [{ ...row, usageType: 'thumb' }, row] });
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile(data));
    const first = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [actualAssetId.toUpperCase()], settings: settings(),
    } as never);
    f.prisma.artist.findUnique.mockResolvedValue({ ...source, artistAssets: [row] });
    const second = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [actualAssetId], settings: settings(),
    } as never);
    expect(first.profile.sourceFingerprint).toBe(second.profile.sourceFingerprint);
    expect(first.profile.referenceAssetIds).toEqual([actualAssetId]);
    expect(f.tx.auditEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      metadata: expect.objectContaining({ referenceAssetCount: 1, referenceChecksums: ['c'.repeat(64)] }),
    }) }));
  });

  it('does not approve settings that no longer produce their stored draft fingerprint', async () => {
    const f = fixture();
    f.tx.artistStoryIdentityProfile.create.mockImplementation(({ data }) => profile(data));
    const saved = await f.service.updateArtistStoryIdentityProfile(userId, artistId, {
      referenceAssetIds: [assetId], settings: settings(),
    } as never);
    const changed = settings();
    changed.sections[0].value.summary = ARTIST_PROFILE_SECTION_KEYS[1];
    f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValue(profile({
      sourceFingerprint: saved.profile.sourceFingerprint, draftFingerprint: saved.profile.draftFingerprint,
      draftSettings: changed,
    }));
    await expect(f.service.approveArtistStoryIdentityProfile(userId, artistId, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).rejects.toMatchObject({ response: { code: 'GENERATION_PROFILE_DRAFT_CHANGED' } });
    expect(f.tx.artistStoryIdentityProfile.updateMany).not.toHaveBeenCalled();
  });
});
