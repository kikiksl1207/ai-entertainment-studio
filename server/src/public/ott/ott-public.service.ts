import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { graphReadiness, MAX_FULL_PLAYBACK_BYTES, playbackGraph, playbackHash } from '../../ott-playback/ott-playback.contract';
import { LOCALES, Locale, Upload } from '../../ott-media/ott-media.contract';
import { OttMediaDelivery, PublicBrowserGrant } from '../../ott-media/ott-media.delivery';
import { mapOttMediaUpload } from '../../ott-media/ott-media.repository';
import { OttMediaService } from '../../ott-media/ott-media.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OttPublicCatalogItem,
  OttPublicReleaseCandidate,
  parseOttPublicReleaseRegistry,
  toOttPublicCatalogItem,
} from './ott-public.contract';

type PublicContext = {
  release: OttPublicReleaseCandidate;
  graph: ReturnType<typeof playbackGraph>;
  ownerId: string;
  uploads: Map<string, Upload>;
};

@Injectable()
export class OttPublicService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly media: OttMediaService, private readonly delivery: OttMediaDelivery) {}

  async list(): Promise<{ items: OttPublicCatalogItem[] }> {
    const candidates = this.releases().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    const items: OttPublicCatalogItem[] = [];
    for (const candidate of candidates) {
      if (await this.context(candidate.slug)) items.push(toOttPublicCatalogItem(candidate));
    }
    return { items };
  }

  async findBySlug(slug: string): Promise<OttPublicCatalogItem | null> {
    const context = await this.context(slug);
    if (!context) return null;
    return { ...toOttPublicCatalogItem(context.release),
      viewing: { available: true, watchPath: `/api/v1/ott/${slug}/watch` } };
  }

  async watch(slug: string, localeValue: unknown) {
    const locale = localeValue === undefined ? 'ko' : localeValue;
    if (!LOCALES.includes(locale as Locale)) return null;
    const context = await this.context(slug);
    if (!context) return null;
    const { graph, uploads } = context;
    return {
      slug, locale,
      entryNodeKey: graph.entryNodeKey,
      nodes: graph.nodes.map((node) => ({
        key: node.key,
        clip: node.clip ? { startMs: node.clip.startMs, endMs: node.clip.endMs } : null,
        choices: node.choices.map((choice) => ({ key: choice.key, label: choice.label[locale as Locale], targetNodeKey: choice.targetNodeKey })),
        ending: node.ending ? { key: node.ending.key, label: node.ending.label[locale as Locale] } : null,
        subtitles: uploads.get(node.clip!.fileId)!.subtitles!.filter((track) => track.locale === locale).flatMap((track) => track.cues
          .filter((cue) => node.clip && cue.endMs > node.clip.startMs && cue.startMs < node.clip.endMs)
          .map((cue) => ({ ...cue, startMs: Math.max(cue.startMs, node.clip!.startMs), endMs: Math.min(cue.endMs, node.clip!.endMs) }))),
        browserPlayback: { sessionPath: `/api/v1/ott/${slug}/nodes/${node.key}/playback-session`, method: 'POST', mode: 'secure_http_only_cookie' },
      })),
      viewing: { available: true },
    };
  }

  async browserSession(slug: string, nodeKey: string) {
    const context = await this.context(slug);
    const node = context?.graph.nodes.find((item) => item.key === nodeKey);
    if (!context || !node?.clip) return null;
    const upload = context.uploads.get(node.clip.fileId);
    if (!upload) return null;
    return this.delivery.issuePublicSession({ slug, manifestId: context.release.manifestId,
      nodeKey, fileId: upload.id, checksum: upload.verified!.sha256 });
  }

  async deliver(slug: string, nodeKey: string, cookie: unknown) {
    const grant = this.delivery.readPublicSession(cookie, slug, nodeKey);
    const context = await this.context(slug);
    if (!context || !this.matchesGrant(context, grant)) return null;
    const upload = context.uploads.get(grant.fileId)!;
    return this.media.deliverPinnedPublic(context.ownerId, upload.id,
      upload.versionId, upload.verified!.sha256);
  }

  private matchesGrant(context: PublicContext, grant: PublicBrowserGrant) {
    const node = context.graph.nodes.find((item) => item.key === grant.nodeKey);
    const upload = context.uploads.get(grant.fileId);
    return grant.manifestId === context.release.manifestId && node?.clip?.fileId === grant.fileId
      && node?.clip?.mediaVersionId === upload?.versionId && grant.checksum === upload?.verified?.sha256;
  }

  private releases() {
    return parseOttPublicReleaseRegistry(this.config.get<string>('OTT_PUBLIC_CATALOG_RELEASES'));
  }

  private async context(slug: string): Promise<PublicContext | null> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
    const release = this.releases().find((item) => item.slug === slug);
    const now = new Date();
    if (!release || release.authorizedAt > now || release.publishedAt > now) return null;
    try {
      const manifest = await this.prisma.ottPlaybackManifest.findFirst({
        where: { id: release.manifestId, workId: release.workId },
        select: { id: true, ownerId: true, workId: true, graph: true, checksum: true },
      });
      if (!manifest || !await this.prisma.user.findFirst({ where: { id: manifest.ownerId, status: 'active', deletedAt: null }, select: { id: true } })) return null;
      const graph = playbackGraph(manifest.graph);
      const refs = new Map(graph.nodes.flatMap((node) => node.clip ? [[node.clip.fileId, node.clip.mediaVersionId] as const] : []));
      if (refs.size !== graph.nodes.length || refs.size > 16 || release.rightsContractVersionIds.length !== refs.size
        || graph.nodes.some((node) => !node.clip || node.clip.startMs !== 0)) return null;
      const mediaVersionIds = [...refs.values()];
      if (new Set(mediaVersionIds).size !== refs.size) return null;
      const pins = await this.prisma.ottPlaybackAssetPin.findMany({
        where: { manifestId: manifest.id, ownerId: manifest.ownerId, workId: manifest.workId }, orderBy: { fileId: 'asc' },
        select: { fileId: true, mediaVersionId: true, checksum: true, durationMs: true, confirmationHash: true },
      });
      if (pins.length !== refs.size || pins.some((pin) => refs.get(pin.fileId) !== pin.mediaVersionId)
        || playbackHash({ schema: 'ott-playback-v1', graph, pins }) !== manifest.checksum) return null;
      const rows = await this.prisma.ottMediaUpload.findMany({
        where: { id: { in: [...refs.keys()] }, ownerId: manifest.ownerId, status: 'confirmed',
          version: { workId: manifest.workId, work: { ownerId: manifest.ownerId } }, revocation: null },
        include: { version: true, revocation: true },
      });
      if (rows.length !== refs.size) return null;
      const uploads = new Map<string, Upload>();
      const assets = rows.map((upload) => {
        if (upload.status !== 'confirmed' || upload.revocation || refs.get(upload.id) !== upload.versionId) {
          throw new Error('invalid upload');
        }
        const mapped = mapOttMediaUpload(upload);
        uploads.set(mapped.id, mapped);
        return this.media.playbackUploadMetadata(mapped);
      });
      if (assets.reduce((total, asset) => total + asset.sizeBytes, 0) > MAX_FULL_PLAYBACK_BYTES
        || assets.some((asset) => {
          const pin = pins.find((item) => item.fileId === asset.fileId);
          return !pin || pin.mediaVersionId !== asset.mediaVersionId || pin.checksum !== asset.sha256
            || pin.durationMs !== asset.durationMs || pin.confirmationHash !== asset.confirmationHash;
        }) || graph.nodes.some((node) => node.clip!.endMs !== uploads.get(node.clip!.fileId)!.verified!.durationMs)) return null;
      const readiness = graphReadiness(graph, assets.map((asset) => ({ fileId: asset.fileId,
        mediaVersionId: asset.mediaVersionId, durationMs: asset.durationMs,
        subtitleLocales: asset.subtitles.map((track) => track.locale) })));
      if (!readiness.fiveLocaleReady) return null;
      const rights = await this.prisma.contentRightsContractVersion.findMany({
        where: { id: { in: release.rightsContractVersionIds }, contentVersionId: { in: mediaVersionIds },
          contract: { workType: 'ott', workId: manifest.workId } },
        select: { id: true, contractId: true, contentVersionId: true, approvalState: true, approvedByUserId: true,
          media: true, regions: true, startsAt: true, endsAt: true, effectiveFrom: true },
      });
      const rightsNow = new Date();
      if (rights.length !== refs.size || new Set(rights.map((right) => right.contentVersionId)).size !== refs.size
        || rights.some((right) => right.contractId !== rights[0].contractId
          || right.approvalState !== 'approved_configuration' || !right.approvedByUserId
          || !Array.isArray(right.media) || !right.media.includes('ott_streaming')
          || !Array.isArray(right.regions) || right.regions.length !== 1 || right.regions[0] !== 'WORLDWIDE'
          || right.startsAt > rightsNow || right.effectiveFrom > rightsNow
          || (right.endsAt && right.endsAt <= rightsNow))) return null;
      const latestApproved = await this.prisma.contentRightsContractVersion.findMany({
        where: { contractId: rights[0].contractId, contentVersionId: { in: mediaVersionIds },
          approvalState: 'approved_configuration' },
        orderBy: { revision: 'desc' }, select: { id: true, contentVersionId: true },
      });
      const latestByVersion = new Map<string, string>();
      for (const right of latestApproved) if (!latestByVersion.has(right.contentVersionId)) {
        latestByVersion.set(right.contentVersionId, right.id);
      }
      if (!mediaVersionIds.every((versionId) => rights.some((right) => right.contentVersionId === versionId
        && latestByVersion.get(versionId) === right.id))) return null;
      for (const asset of assets) {
        const opened = await this.media.deliverPinnedPublic(manifest.ownerId, asset.fileId, asset.mediaVersionId, asset.sha256);
        await opened.close();
      }
      return { release, graph, ownerId: manifest.ownerId, uploads };
    } catch { return null; }
  }
}
