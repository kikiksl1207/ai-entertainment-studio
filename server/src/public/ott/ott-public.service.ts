import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { playbackGraph } from '../../ott-playback/ott-playback.contract';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OttPublicCatalogItem,
  OttPublicReleaseCandidate,
  parseOttPublicReleaseRegistry,
  toOttPublicCatalogItem,
} from './ott-public.contract';

@Injectable()
export class OttPublicService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async list(): Promise<{ items: OttPublicCatalogItem[] }> {
    const now = new Date();
    const candidates = parseOttPublicReleaseRegistry(this.config.get<string>('OTT_PUBLIC_CATALOG_RELEASES'))
      .filter((release) => release.authorizedAt <= now && release.publishedAt <= now)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    const items: OttPublicCatalogItem[] = [];
    for (const candidate of candidates) {
      if (await this.isPubliclyEligible(candidate, now)) items.push(toOttPublicCatalogItem(candidate));
    }
    return { items };
  }

  async findBySlug(slug: string): Promise<OttPublicCatalogItem | null> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
    const now = new Date();
    const candidate = parseOttPublicReleaseRegistry(this.config.get<string>('OTT_PUBLIC_CATALOG_RELEASES'))
      .find((release) => release.slug === slug && release.authorizedAt <= now && release.publishedAt <= now);
    if (!candidate || !(await this.isPubliclyEligible(candidate, now))) return null;
    return toOttPublicCatalogItem(candidate);
  }

  private async isPubliclyEligible(release: OttPublicReleaseCandidate, now: Date): Promise<boolean> {
    try {
      const manifest = await this.prisma.ottPlaybackManifest.findFirst({
        where: { id: release.manifestId, workId: release.workId },
        select: { id: true, ownerId: true, workId: true, graph: true },
      });
      if (!manifest) return false;
      const graph = playbackGraph(manifest.graph);
      const fileRefs = new Map(graph.nodes.flatMap((node) => node.clip
        ? [[node.clip.fileId, node.clip.mediaVersionId] as const]
        : []));
      if (!fileRefs.size) return false;

      const pins = await this.prisma.ottPlaybackAssetPin.findMany({
        where: { manifestId: manifest.id, ownerId: manifest.ownerId, workId: manifest.workId },
        select: { fileId: true, mediaVersionId: true, confirmationHash: true },
      });
      if (pins.length !== fileRefs.size || pins.some((pin) =>
        fileRefs.get(pin.fileId) !== pin.mediaVersionId || !pin.confirmationHash)) return false;

      const uploads = await this.prisma.ottMediaUpload.findMany({
        where: { id: { in: [...fileRefs.keys()] }, ownerId: manifest.ownerId, status: 'confirmed' },
        select: { id: true, versionId: true, confirmationHash: true, verified: true, revocation: { select: { fileId: true } } },
      });
      if (uploads.length !== fileRefs.size || uploads.some((upload) =>
        fileRefs.get(upload.id) !== upload.versionId || !upload.confirmationHash || !upload.verified || upload.revocation)) return false;

      const mediaVersionIds = [...new Set(fileRefs.values())];
      const rights = await this.prisma.contentRightsContractVersion.findMany({
        where: {
          id: { in: release.rightsContractVersionIds },
          contentVersionId: { in: mediaVersionIds },
          approvalState: 'approved_configuration',
          approvedByUserId: { not: null },
          contract: { workType: 'ott', workId: manifest.workId },
        },
        select: { contentVersionId: true, media: true, startsAt: true, endsAt: true, effectiveFrom: true },
      });
      const coveredMediaVersions = new Set(rights.map((right) => right.contentVersionId));
      return rights.length === release.rightsContractVersionIds.length &&
        coveredMediaVersions.size === mediaVersionIds.length &&
        mediaVersionIds.every((versionId) => coveredMediaVersions.has(versionId)) &&
        rights.every((right) => Array.isArray(right.media) && right.media.includes('ott_streaming') &&
          right.startsAt <= now && right.effectiveFrom <= now && (!right.endsAt || right.endsAt > now));
    } catch {
      return false;
    }
  }
}
