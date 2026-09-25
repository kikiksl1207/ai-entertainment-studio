import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { buildPublicAssetUrl } from '../common/asset-url';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import type { StoryArtistCandidateQueryDto } from './dto/story-production.dto';

type ParticipantSource = 'liked' | 'voted' | 'liked_and_voted' | 'search';

type ArtistCandidateRow = {
  id: string;
  slug: string;
  displayName: string;
  artistAssets: Array<{
    usageType: string;
    isPrimary: boolean;
    sortOrder: number;
    asset: { id: string; storageKey: string; mimeType: string; metadata: Prisma.JsonValue };
  }>;
  storyIdentityProfiles: Array<{
    id: string;
    profileVersion: number;
    reviewRevision: number;
    status: string;
    sourceFingerprint: string;
    approvedFingerprint: string | null;
    approvedSettings: Prisma.JsonValue | null;
    referenceAssetIds: Prisma.JsonValue;
  }>;
};

export type StoryParticipantPin = {
  id: string;
  artistId: string;
  participantFingerprint: string;
  identityProfileId: string | null;
  identityProfileVersion: number | null;
  identityReviewRevision: number | null;
  identitySourceFingerprint: string | null;
  identityApprovedFingerprint: string | null;
  referenceAssetIds: string[];
  referenceChecksums: string[];
};

export type StoryApprovedParticipant = {
  artistId: string;
  slug: string;
  displayName: string;
  visualIdentityReady: boolean;
  identityProfile?: {
    schemaVersion: typeof CREATOR_GENERATION_PROFILE_SCHEMA;
    sections: Array<{ key: string; value: Record<string, unknown> }>;
  };
};

export type StoryParticipantVisualReference = {
  assetId: string;
  checksum: string;
  storageProvider: 'local' | 'r2' | 's3';
  storageKey: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  fileSizeBytes: number;
};

@Injectable()
export class StoryArtistParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async candidates(userId: string, workId: string, query: StoryArtistCandidateQueryDto) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, status: 'published', fixtureSource: false },
      select: { id: true },
    });
    if (!work) throw new NotFoundException('Published story not found');

    const [likedRows, votedRows] = await Promise.all([
      this.prisma.artistBoostEvent.findMany({
        where: { userId }, select: { artistId: true }, distinct: ['artistId'], take: 200,
      }),
      this.prisma.conceptVoteBallot.findMany({
        where: { userId },
        select: { vote: { select: { artistId: true } } },
        take: 200,
      }),
    ]);
    const liked = new Set(likedRows.map((row) => row.artistId));
    const voted = new Set(votedRows.flatMap((row) => row.vote.artistId ? [row.vote.artistId] : []));
    const engagedIds = [...new Set([...liked, ...voted])];
    const search = query.q?.trim() ?? '';

    const [engagedRows, searchRows, current] = await Promise.all([
      engagedIds.length
        ? this.prisma.artist.findMany({
            where: { id: { in: engagedIds }, status: 'active' },
            ...this.artistCandidateQuery,
            orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
          })
        : Promise.resolve([]),
      search
        ? this.prisma.artist.findMany({
            where: {
              status: 'active',
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ],
            },
            ...this.artistCandidateQuery,
            orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
            take: query.take,
          })
        : Promise.resolve([]),
      this.prisma.storyProgressArtistParticipant.findUnique({
        where: { userId_workId: { userId, workId } },
        select: { progressId: true, artistId: true },
      }),
    ]);

    return {
      engaged: (engagedRows as ArtistCandidateRow[]).map((row) =>
        this.candidateProjection(row, this.selectionSource(row.id, liked, voted))),
      searchResults: (searchRows as ArtistCandidateRow[]).map((row) =>
        this.candidateProjection(row, this.selectionSource(row.id, liked, voted))),
      query: search,
      selectedArtistId: current?.artistId ?? null,
      selectionLocked: Boolean(current),
      policy: {
        maximumParticipants: 1,
        defaultSources: ['liked', 'voted'],
        searchableArtists: 'all_active_registered_artists',
        selectionScope: 'story_progress',
      },
    };
  }

  async bind(
    tx: PrismaService | Prisma.TransactionClient,
    input: { progressId: string; userId: string; workId: string; artistId: string },
  ) {
    const existing = await tx.storyProgressArtistParticipant.findUnique({
      where: { progressId: input.progressId },
    });
    if (existing) {
      if (existing.artistId !== input.artistId) this.locked();
      return existing;
    }
    const artist = await tx.artist.findFirst({
      where: { id: input.artistId, status: 'active' },
      select: {
        id: true, slug: true, displayName: true,
        storyIdentityProfiles: {
          where: { status: 'approved' }, orderBy: { profileVersion: 'desc' }, take: 1,
          select: {
            id: true, profileVersion: true, reviewRevision: true, status: true,
            sourceFingerprint: true, approvedFingerprint: true, approvedSettings: true,
            referenceAssetIds: true,
          },
        },
      },
    });
    if (!artist) throw new NotFoundException({
      code: 'STORY_PARTICIPANT_ARTIST_NOT_FOUND',
      messageKey: 'story.participant.error.notFound',
    });
    const [liked, voted] = await Promise.all([
      tx.artistBoostEvent.findFirst({ where: { userId: input.userId, artistId: input.artistId }, select: { id: true } }),
      tx.conceptVoteBallot.findFirst({
        where: { userId: input.userId, vote: { artistId: input.artistId } }, select: { id: true },
      }),
    ]);
    const source: ParticipantSource = liked && voted ? 'liked_and_voted' : liked ? 'liked' : voted ? 'voted' : 'search';
    const identity = await this.validIdentitySnapshot(tx, artist.id, artist.storyIdentityProfiles[0]);
    if (!identity) {
      throw new ConflictException({
        code: 'STORY_PARTICIPANT_IDENTITY_NOT_READY',
        messageKey: 'story.participant.error.identityNotReady',
        retryable: false,
      });
    }
    const fingerprintInput = {
      artistId: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
      identity: identity.pin,
      referenceAssetIds: identity.referenceAssetIds,
      referenceChecksums: identity.referenceChecksums,
    };
    return tx.storyProgressArtistParticipant.create({
      data: {
        progressId: input.progressId,
        userId: input.userId,
        workId: input.workId,
        artistId: artist.id,
        selectionSource: source,
        identityProfileId: identity.pin.id,
        identityProfileVersion: identity.pin.profileVersion,
        identityReviewRevision: identity.pin.reviewRevision,
        identitySourceFingerprint: identity.pin.sourceFingerprint,
        identityApprovedFingerprint: identity.pin.approvedFingerprint,
        referenceAssetIds: identity.referenceAssetIds,
        referenceChecksums: identity.referenceChecksums,
        participantFingerprint: this.hash(fingerprintInput),
      },
    });
  }

  async projection(progressId: string) {
    const row = await this.prisma.storyProgressArtistParticipant.findUnique({
      where: { progressId },
      include: {
        artist: {
          select: {
            id: true, slug: true, displayName: true,
            artistAssets: {
              where: { asset: { visibility: 'public' } },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 8,
              include: { asset: true },
            },
          },
        },
      },
    });
    if (!row) return null;
    const thumbnail = this.thumbnail(row.artist.artistAssets);
    return {
      artistId: row.artistId,
      slug: row.artist.slug,
      displayName: row.artist.displayName,
      selectionSource: row.selectionSource,
      thumbnail,
      visualIdentityReady: Boolean(row.identityProfileId && this.stringArray(row.referenceAssetIds).length),
      locked: true,
    };
  }

  async pinnedContext(prisma: PrismaService | Prisma.TransactionClient, progressId: string) {
    const participant = await prisma.storyProgressArtistParticipant.findUnique({
      where: { progressId },
      include: { artist: { select: { id: true, slug: true, displayName: true } } },
    });
    if (!participant) return null;
    const pin = this.participantPin(participant);
    let identityProfile: StoryApprovedParticipant['identityProfile'];
    if (pin.identityProfileId) {
      const profile = await prisma.artistStoryIdentityProfile.findFirst({
        where: {
          id: pin.identityProfileId,
          artistId: participant.artistId,
          profileVersion: pin.identityProfileVersion!,
          reviewRevision: pin.identityReviewRevision!,
          sourceFingerprint: pin.identitySourceFingerprint!,
          approvedFingerprint: pin.identityApprovedFingerprint!,
          status: 'approved',
        },
      });
      if (!profile?.approvedSettings) this.changed();
      const normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings);
      if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) this.changed();
      const assets = await prisma.artistAsset.findMany({
        where: { artistId: participant.artistId, assetId: { in: pin.referenceAssetIds }, asset: { visibility: 'public' } },
        select: { assetId: true, asset: { select: { checksum: true } } },
      });
      const checksumById = new Map(assets.map((asset) => [asset.assetId, asset.asset.checksum]));
      if (pin.referenceAssetIds.some((id, index) => checksumById.get(id) !== pin.referenceChecksums[index])) this.changed();
      identityProfile = {
        schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
        sections: normalized.sections
          .filter((section) => section.decision === 'accepted' || section.decision === 'edited')
          .map((section) => ({ key: section.key, value: section.value })),
      };
    }
    return {
      pin,
      approved: {
        artistId: participant.artistId,
        slug: participant.artist.slug,
        displayName: participant.artist.displayName,
        visualIdentityReady: Boolean(identityProfile),
        ...(identityProfile ? { identityProfile } : {}),
      } satisfies StoryApprovedParticipant,
    };
  }

  async visualReferences(progressId: string) {
    const context = await this.pinnedContext(this.prisma, progressId);
    if (!context) return null;
    if (!context.pin.identityProfileId || !context.pin.referenceAssetIds.length) {
      return {
        participantFingerprint: context.pin.participantFingerprint,
        artistId: context.pin.artistId,
        references: [] as StoryParticipantVisualReference[],
      };
    }
    const rows = await this.prisma.artistAsset.findMany({
      where: {
        artistId: context.pin.artistId,
        assetId: { in: context.pin.referenceAssetIds },
        asset: { visibility: 'public', assetType: 'image' },
      },
      select: {
        assetId: true,
        asset: {
          select: {
            checksum: true,
            storageProvider: true,
            storageKey: true,
            mimeType: true,
            fileSizeBytes: true,
          },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.assetId, row.asset]));
    const references = context.pin.referenceAssetIds.map((assetId, index) => {
      const asset = byId.get(assetId);
      const expectedChecksum = context.pin.referenceChecksums[index];
      const fileSizeBytes = Number(asset?.fileSizeBytes ?? -1);
      if (!asset || asset.checksum !== expectedChecksum ||
          !['local', 'r2', 's3'].includes(asset.storageProvider) ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ||
          !Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 1 || fileSizeBytes > 50 * 1024 * 1024) {
        this.changed();
      }
      return {
        assetId,
        checksum: expectedChecksum,
        storageProvider: asset.storageProvider as StoryParticipantVisualReference['storageProvider'],
        storageKey: asset.storageKey,
        mimeType: asset.mimeType as StoryParticipantVisualReference['mimeType'],
        fileSizeBytes,
      };
    });
    return {
      participantFingerprint: context.pin.participantFingerprint,
      artistId: context.pin.artistId,
      references,
    };
  }

  private readonly artistCandidateQuery = {
    select: {
      id: true, slug: true, displayName: true,
      artistAssets: {
        where: { asset: { visibility: 'public' as const } },
        orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
        take: 8,
        select: {
          usageType: true, isPrimary: true, sortOrder: true,
          asset: { select: { id: true, storageKey: true, mimeType: true, metadata: true } },
        },
      },
      storyIdentityProfiles: {
        where: { status: 'approved' }, orderBy: { profileVersion: 'desc' as const }, take: 1,
        select: {
          id: true, profileVersion: true, reviewRevision: true, status: true,
          sourceFingerprint: true, approvedFingerprint: true, approvedSettings: true,
          referenceAssetIds: true,
        },
      },
    },
  };

  private candidateProjection(row: ArtistCandidateRow, source: ParticipantSource) {
    const thumbnail = this.thumbnail(row.artistAssets);
    const profile = row.storyIdentityProfiles[0];
    return {
      artistId: row.id,
      slug: row.slug,
      displayName: row.displayName,
      source,
      thumbnail,
      visualIdentityReady: Boolean(profile?.approvedFingerprint && this.stringArray(profile.referenceAssetIds).length),
    };
  }

  private selectionSource(id: string, liked: Set<string>, voted: Set<string>): ParticipantSource {
    return liked.has(id) && voted.has(id) ? 'liked_and_voted' : liked.has(id) ? 'liked' : voted.has(id) ? 'voted' : 'search';
  }

  private thumbnail(assets: ArtistCandidateRow['artistAssets']) {
    const item = assets.find((asset) => asset.usageType === 'thumb') ??
      assets.find((asset) => asset.usageType === 'cover') ?? assets[0];
    if (!item || !item.asset.mimeType.startsWith('image/') || !this.publicReady(item.asset.metadata)) return null;
    return {
      assetId: item.asset.id,
      publicUrl: buildPublicAssetUrl(this.config, item.asset.storageKey, null),
    };
  }

  private async validIdentitySnapshot(tx: PrismaService | Prisma.TransactionClient, artistId: string, profile?: ArtistCandidateRow['storyIdentityProfiles'][number]) {
    if (!profile?.approvedFingerprint || !profile.approvedSettings) return null;
    try {
      const normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings);
      if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) return null;
      const ids = this.stringArray(profile.referenceAssetIds);
      if (ids.length < 1 || ids.length > 8) return null;
      const rows = await tx.artistAsset.findMany({
        where: { artistId, assetId: { in: ids }, asset: { visibility: 'public' } },
        select: { assetId: true, asset: { select: { checksum: true, mimeType: true } } },
      });
      const byId = new Map(rows.map((row) => [row.assetId, row.asset]));
      const checksums = ids.map((id) => byId.get(id)?.checksum ?? '');
      if (checksums.some((checksum) => !/^[a-f0-9]{64}$/.test(checksum)) ||
          ids.some((id) => !byId.get(id)?.mimeType.startsWith('image/'))) return null;
      return {
        pin: {
          id: profile.id,
          profileVersion: profile.profileVersion,
          reviewRevision: profile.reviewRevision,
          sourceFingerprint: profile.sourceFingerprint,
          approvedFingerprint: profile.approvedFingerprint,
        },
        referenceAssetIds: ids,
        referenceChecksums: checksums,
      };
    } catch {
      return null;
    }
  }

  private participantPin(row: {
    id: string; artistId: string; participantFingerprint: string;
    identityProfileId: string | null; identityProfileVersion: number | null;
    identityReviewRevision: number | null; identitySourceFingerprint: string | null;
    identityApprovedFingerprint: string | null; referenceAssetIds: Prisma.JsonValue;
    referenceChecksums: Prisma.JsonValue;
  }): StoryParticipantPin {
    return {
      id: row.id,
      artistId: row.artistId,
      participantFingerprint: row.participantFingerprint,
      identityProfileId: row.identityProfileId,
      identityProfileVersion: row.identityProfileVersion,
      identityReviewRevision: row.identityReviewRevision,
      identitySourceFingerprint: row.identitySourceFingerprint,
      identityApprovedFingerprint: row.identityApprovedFingerprint,
      referenceAssetIds: this.stringArray(row.referenceAssetIds),
      referenceChecksums: this.stringArray(row.referenceChecksums),
    };
  }

  private publicReady(value: Prisma.JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
    const lifecycle = (value as Record<string, Prisma.JsonValue>).lifecycle;
    return !lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle) ||
      (lifecycle as Record<string, Prisma.JsonValue>).status !== 'archived';
  }

  private stringArray(value: Prisma.JsonValue) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private hash(value: unknown) {
    return createHash('sha256').update(stableJson(value)).digest('hex');
  }

  private locked(): never {
    throw new ConflictException({
      code: 'STORY_PARTICIPANT_LOCKED',
      messageKey: 'story.participant.error.locked',
      retryable: false,
    });
  }

  private changed(): never {
    throw new ConflictException({
      code: 'STORY_PARTICIPANT_IDENTITY_CHANGED',
      messageKey: 'story.participant.error.identityChanged',
      retryable: false,
    });
  }
}
