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

type ParticipantProgress = {
  currentBeatPosition: number;
  currentGeneratedSceneId: string | null;
  pathSummary: Prisma.JsonValue;
  status: string;
};

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

type IdentityReferenceRow = {
  artistId: string;
  assetId: string;
  asset: {
    checksum: string | null;
    mimeType: string;
    metadata: Prisma.JsonValue;
    storageProvider: string;
    fileSizeBytes: bigint | null;
  };
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

    const [engagedRows, searchRows, current, progress] = await Promise.all([
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
      this.prisma.storyReaderProgress.findUnique({
        where: { userId_workId: { userId, workId } },
        select: { currentBeatPosition: true, currentGeneratedSceneId: true, pathSummary: true, status: true },
      }),
    ]);

    const candidateRows = [...new Map(([
      ...engagedRows as ArtistCandidateRow[], ...searchRows as ArtistCandidateRow[],
    ]).map((row) => [row.id, row])).values()];
    const referenceIds = [...new Set(candidateRows.flatMap((row) =>
      this.stringArray(row.storyIdentityProfiles[0]?.referenceAssetIds)))];
    const references = referenceIds.length ? await this.prisma.artistAsset.findMany({
      where: {
        artistId: { in: candidateRows.map((row) => row.id) },
        assetId: { in: referenceIds },
        asset: { visibility: 'public' },
      },
      select: { artistId: true, assetId: true, asset: { select: {
        checksum: true, mimeType: true, metadata: true, storageProvider: true, fileSizeBytes: true,
      } } },
    }) : [];
    const referencesByArtist = new Map<string, IdentityReferenceRow[]>();
    for (const reference of references) {
      const rows = referencesByArtist.get(reference.artistId) ?? [];
      rows.push(reference);
      referencesByArtist.set(reference.artistId, rows);
    }
    const project = (row: ArtistCandidateRow) => this.candidateProjection(
      row, this.selectionSource(row.id, liked, voted),
      Boolean(this.identitySnapshotFromAssets(row.storyIdentityProfiles[0], referencesByArtist.get(row.id) ?? [])),
    );

    return {
      engaged: (engagedRows as ArtistCandidateRow[]).map(project),
      searchResults: (searchRows as ArtistCandidateRow[]).map(project),
      query: search,
      selectedArtistId: current?.artistId ?? null,
      selectionLocked: Boolean(current || (progress && !this.canFirstBind(progress))),
      policy: {
        maximumParticipants: 1,
        defaultSources: ['liked', 'voted'],
        searchableArtists: 'all_active_registered_artists',
        selectionScope: 'story_progress',
      },
    };
  }

  async bind(
    tx: Prisma.TransactionClient,
    input: { progressId: string; userId: string; workId: string; artistId: string },
  ) {
    // Reading and first participation share the progress row, so the winner fixes the start state.
    const [progress] = await tx.$queryRaw<ParticipantProgress[]>(Prisma.sql`
      SELECT current_beat_position AS "currentBeatPosition",
        current_generated_scene_id AS "currentGeneratedSceneId", path_summary AS "pathSummary", status
      FROM story_reader_progress
      WHERE id = ${input.progressId}::uuid AND user_id = ${input.userId}::uuid AND work_id = ${input.workId}::uuid
      FOR UPDATE
    `);
    if (!progress) throw new NotFoundException('Story progress not found');
    const existing = await tx.storyProgressArtistParticipant.findUnique({
      where: { progressId: input.progressId },
    });
    if (existing) {
      if (existing.artistId !== input.artistId || existing.userId !== input.userId || existing.workId !== input.workId) this.locked();
      return existing;
    }
    if (!this.canFirstBind(progress)) this.locked();
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
    let visualIdentityReady = false;
    if (row.identityProfileId && this.stringArray(row.referenceAssetIds).length) {
      try {
        visualIdentityReady = Boolean((await this.visualReferences(progressId))?.references.length);
      } catch (error) {
        const response = error instanceof ConflictException ? error.getResponse() : null;
        if (!response || typeof response !== 'object' ||
            (response as { code?: string }).code !== 'STORY_PARTICIPANT_IDENTITY_CHANGED') throw error;
      }
    }
    return {
      artistId: row.artistId,
      slug: row.artist.slug,
      displayName: row.artist.displayName,
      selectionSource: row.selectionSource,
      thumbnail,
      visualIdentityReady,
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
    if (participant.artist.id !== pin.artistId || pin.participantFingerprint !== this.hash({
      artistId: pin.artistId, slug: participant.artist.slug, displayName: participant.artist.displayName,
      identity: pin.identityProfileId ? { id: pin.identityProfileId, profileVersion: pin.identityProfileVersion,
        reviewRevision: pin.identityReviewRevision, sourceFingerprint: pin.identitySourceFingerprint,
        approvedFingerprint: pin.identityApprovedFingerprint } : null,
      referenceAssetIds: pin.referenceAssetIds, referenceChecksums: pin.referenceChecksums,
    })) this.changed();
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
        select: { assetId: true, asset: { select: { checksum: true, metadata: true } } },
      });
      const assetById = new Map(assets.map((asset) => [asset.assetId, asset.asset]));
      if (pin.referenceAssetIds.some((id, index) => {
        const asset = assetById.get(id);
        return !asset || !this.publicReady(asset.metadata) || asset.checksum !== pin.referenceChecksums[index];
      })) this.changed();
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
            metadata: true,
          },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.assetId, row.asset]));
    const references = context.pin.referenceAssetIds.map((assetId, index) => {
      const asset = byId.get(assetId);
      const expectedChecksum = context.pin.referenceChecksums[index];
      const fileSizeBytes = Number(asset?.fileSizeBytes ?? -1);
      if (!asset || !this.publicReady(asset.metadata) || asset.checksum !== expectedChecksum ||
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

  private candidateProjection(row: ArtistCandidateRow, source: ParticipantSource, visualIdentityReady: boolean) {
    const thumbnail = this.thumbnail(row.artistAssets);
    return {
      artistId: row.id,
      slug: row.slug,
      displayName: row.displayName,
      source,
      thumbnail,
      visualIdentityReady,
    };
  }

  private selectionSource(id: string, liked: Set<string>, voted: Set<string>): ParticipantSource {
    return liked.has(id) && voted.has(id) ? 'liked_and_voted' : liked.has(id) ? 'liked' : voted.has(id) ? 'voted' : 'search';
  }

  private canFirstBind(progress: ParticipantProgress) {
    return progress.status === 'active' && progress.currentBeatPosition === 0 &&
      progress.currentGeneratedSceneId === null && Array.isArray(progress.pathSummary) && progress.pathSummary.length === 0;
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
      const ids = this.stringArray(profile.referenceAssetIds);
      if (ids.length < 1 || ids.length > 8) return null;
      const rows = await tx.artistAsset.findMany({
        where: { artistId, assetId: { in: ids }, asset: { visibility: 'public' } },
        select: { artistId: true, assetId: true, asset: { select: {
          checksum: true, mimeType: true, metadata: true, storageProvider: true, fileSizeBytes: true,
        } } },
      });
      return this.identitySnapshotFromAssets(profile, rows);
    } catch {
      return null;
    }
  }

  private identitySnapshotFromAssets(profile: ArtistCandidateRow['storyIdentityProfiles'][number] | undefined,
    rows: IdentityReferenceRow[]) {
    if (!profile?.approvedFingerprint || !profile.approvedSettings) return null;
    try {
      const normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings);
      if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) return null;
      const ids = this.stringArray(profile.referenceAssetIds);
      if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length) return null;
      const byId = new Map(rows.map((row) => [row.assetId, row.asset]));
      const checksums = ids.map((id) => byId.get(id)?.checksum ?? '');
      if (checksums.some((checksum) => !/^[a-f0-9]{64}$/.test(checksum)) ||
          ids.some((id) => {
            const asset = byId.get(id);
            const bytes = Number(asset?.fileSizeBytes ?? -1);
            return !asset || !this.publicReady(asset.metadata) ||
              !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ||
              !['local', 'r2', 's3'].includes(asset.storageProvider) ||
              !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 50 * 1024 * 1024;
          })) return null;
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
    return lifecycle === undefined || (lifecycle !== null && typeof lifecycle === 'object' &&
      !Array.isArray(lifecycle) && (lifecycle as Record<string, Prisma.JsonValue>).status === 'active');
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
