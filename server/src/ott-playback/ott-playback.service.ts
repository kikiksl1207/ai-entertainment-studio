import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, OttPlaybackManifest, OttPlaybackProgress } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fail, intentKey, LOCALES, Locale, object, Upload, uuid } from '../ott-media/ott-media.contract';
import { mapOttMediaUpload } from '../ott-media/ott-media.repository';
import { OttMediaService } from '../ott-media/ott-media.service';
import { createPlaybackManifest, graphReadiness, MAX_FULL_PLAYBACK_BYTES, PlaybackGraph, PlaybackIssue, playbackCommand, playbackGraph, playbackHash } from './ott-playback.contract';

type Client = Prisma.TransactionClient;
type Asset = Awaited<ReturnType<OttMediaService['inspectPlaybackUpload']>>;
type Pin = { fileId: string; mediaVersionId: string; checksum: string; durationMs: number; confirmationHash: string };
type Snapshot = Pick<OttPlaybackProgress, 'currentNodeKey' | 'positionMs' | 'revision' | 'status'>;
type ByteValidation = 'current_scene' | 'current_and_target' | 'not_checked';
const MAX_SOURCE_FILES = 16;

@Injectable()
export class OttPlaybackService {
  constructor(private readonly prisma: PrismaService, private readonly media: OttMediaService) {}

  async createManifest(ownerValue: string, workValue: string, keyValue: unknown, body: unknown) {
    const ownerId = uuid(ownerValue); const workId = uuid(workValue); const requestKey = intentKey(keyValue);
    const input = createPlaybackManifest(body); const requestHash = playbackHash(input);
    return this.transaction(async (tx) => {
      await this.lockOwner(tx, ownerId);
      await tx.$queryRaw`SELECT id FROM ott_media_works WHERE id=${workId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      if (!await tx.ottMediaWork.findFirst({ where: { id: workId, ownerId } })) fail('NOT_FOUND');
      const prior = await tx.ottPlaybackManifest.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey } } });
      if (prior) {
        if (prior.workId !== workId || prior.requestHash !== requestHash) fail('CONFLICT');
        return { ...await this.manifestProjection(tx, prior), idempotentReplay: true };
      }
      const inspected = await this.inspectAssets(tx, ownerId, workId, input.graph, true, true);
      if (graphReadiness(input.graph, this.readinessAssets(inspected.assets)).issues.some((issue) => issue.code === 'clip_out_of_bounds')) fail('INVALID');
      const pins = inspected.assets.map(this.pin).sort((a, b) => a.fileId.localeCompare(b.fileId));
      const last = await tx.ottPlaybackManifest.findFirst({ where: { workId }, orderBy: { revision: 'desc' } });
      const manifest = await tx.ottPlaybackManifest.create({ data: {
        ownerId, workId, revision: (last?.revision ?? 0) + 1, graph: input.graph as unknown as Prisma.InputJsonValue,
        checksum: this.checksum(input.graph, pins), requestKey, requestHash,
      } });
      for (const pin of pins) await tx.ottPlaybackAssetPin.create({ data: { manifestId: manifest.id, ownerId, workId, ...pin } });
      return { ...this.projectManifest(manifest, input.graph, inspected.assets, inspected.issues), idempotentReplay: false };
    });
  }

  async listManifests(ownerValue: string, workValue: string, queryValue: unknown) {
    const ownerId = uuid(ownerValue); const workId = uuid(workValue); const query = object(queryValue, ['limit', 'cursor']);
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID');
    const cursor = query.cursor === undefined ? null : uuid(query.cursor);
    return this.transaction(async (tx) => {
      if (!await tx.ottMediaWork.findFirst({ where: { id: workId, ownerId } })) fail('NOT_FOUND');
      const after = cursor ? await tx.ottPlaybackManifest.findFirst({ where: { id: cursor, ownerId, workId } }) : null;
      if (cursor && !after) fail('NOT_FOUND');
      const rows = await tx.ottPlaybackManifest.findMany({ where: { ownerId, workId, ...(after ? { revision: { lt: after.revision } } : {}) },
        orderBy: { revision: 'desc' }, take: limit + 1 });
      return { items: rows.slice(0, limit).map((row) => ({ manifestId: row.id, graphRevision: row.revision,
        checksum: row.checksum, createdAt: row.createdAt, validation: 'not_checked', visibility: 'private' })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    });
  }

  async getManifest(ownerValue: string, manifestValue: string) {
    const ownerId = uuid(ownerValue); const id = uuid(manifestValue);
    return this.transaction(async (tx) => this.manifestProjection(tx, await this.ownedManifest(tx, ownerId, id)));
  }

  async pinPreview(ownerValue: string, manifestValue: string, body: unknown) {
    const ownerId = uuid(ownerValue); const id = uuid(manifestValue); const input = object(body, ['locale']);
    const locale = this.locale(input.locale);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ott_playback_manifests WHERE id=${id}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      const manifest = await this.ownedManifest(tx, ownerId, id);
      const context = await this.manifestContext(tx, manifest, true);
      this.requireReady(context, locale);
      const prior = await tx.ottPlaybackPreview.findUnique({ where: { manifestId_locale: { manifestId: id, locale } } });
      const preview = prior ?? await tx.ottPlaybackPreview.create({ data: { manifestId: id, ownerId, workId: manifest.workId, locale } });
      return { previewId: preview.id, manifestId: id, graphRevision: manifest.revision, checksum: manifest.checksum,
        locale, visibility: 'private', publication: 'not_authorized', idempotentReplay: Boolean(prior), readiness: context.readiness };
    });
  }

  async startProgress(ownerValue: string, previewValue: string, body: unknown) {
    const ownerId = uuid(ownerValue); const previewId = uuid(previewValue); object(body, []);
    return this.transaction(async (tx) => {
      await this.lockOwner(tx, ownerId);
      const preview = await tx.ottPlaybackPreview.findFirst({ where: { id: previewId, ownerId } });
      if (!preview) fail('NOT_FOUND');
      const manifest = await this.ownedManifest(tx, ownerId, preview.manifestId);
      const context = await this.manifestContext(tx, manifest); const locale = this.locale(preview.locale);
      this.requireReady(context, locale);
      const prior = await tx.ottPlaybackProgress.findUnique({ where: { ownerId_previewId: { ownerId, previewId } } });
      const entry = context.graph.nodes.find((node) => node.key === context.graph.entryNodeKey)!;
      await this.verifyNodeBytes(context, [prior?.currentNodeKey ?? entry.key]);
      const progress = prior ?? await tx.ottPlaybackProgress.create({ data: { ownerId, workId: manifest.workId,
        manifestId: manifest.id, previewId, currentNodeKey: entry.key, positionMs: entry.clip!.startMs } });
      return this.progressProjection(progress, manifest, context, locale, Boolean(prior), 'current_scene');
    });
  }

  async getProgress(ownerValue: string, progressValue: string) {
    const ownerId = uuid(ownerValue); const id = uuid(progressValue);
    return this.transaction(async (tx) => {
      const progress = await this.ownedProgress(tx, ownerId, id);
      const manifest = await this.ownedManifest(tx, ownerId, progress.manifestId);
      const context = await this.manifestContext(tx, manifest);
      const preview = await tx.ottPlaybackPreview.findUniqueOrThrow({ where: { id: progress.previewId } });
      const locale = this.locale(preview.locale); this.requireReady(context, locale);
      await this.verifyNodeBytes(context, [progress.currentNodeKey]);
      return this.progressProjection(progress, manifest, context, locale, false, 'current_scene');
    });
  }

  async command(ownerValue: string, progressValue: string, kind: 'choice' | 'position', keyValue: unknown, body: unknown) {
    const ownerId = uuid(ownerValue); const id = uuid(progressValue); const idempotencyKey = intentKey(keyValue);
    const input = playbackCommand(body, kind); const requestHash = playbackHash({ kind, input });
    return this.transaction(async (tx) => {
      // Owner-scoped receipts plus a progress lock serialize double clicks,
      // competing choices and position saves across server processes.
      await this.lockOwner(tx, ownerId);
      await tx.$queryRaw`SELECT id FROM ott_playback_progress WHERE id=${id}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      const progress = await this.ownedProgress(tx, ownerId, id);
      if (progress.manifestId !== input.manifestId) fail('CONFLICT');
      const manifest = await this.ownedManifest(tx, ownerId, progress.manifestId);
      const context = await this.manifestContext(tx, manifest);
      const preview = await tx.ottPlaybackPreview.findUniqueOrThrow({ where: { id: progress.previewId } });
      const locale = this.locale(preview.locale); this.requireReady(context, locale);
      const replay = await tx.ottPlaybackCommand.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } } });
      if (replay) {
        if (replay.progressId !== id || replay.requestHash !== requestHash || replay.kind !== kind) fail('CONFLICT');
        const snapshot = replay.snapshot as unknown as Snapshot;
        if (kind === 'choice') await this.verifyNodeBytes(context, [progress.currentNodeKey, snapshot.currentNodeKey]);
        return this.progressProjection({ ...progress, ...snapshot }, manifest, context, locale, true,
          kind === 'choice' ? 'current_and_target' : 'not_checked');
      }
      if (progress.revision !== input.expectedRevision || progress.currentNodeKey !== input.nodeKey) fail('CONFLICT');
      const current = context.graph.nodes.find((node) => node.key === progress.currentNodeKey)!;
      let node = current; let positionMs: number;
      if (kind === 'choice') {
        if (!('choiceKey' in input)) fail('INVALID');
        const choice = current.choices.find((choice) => choice.key === input.choiceKey);
        if (!choice) fail('INVALID');
        node = context.graph.nodes.find((node) => node.key === choice.targetNodeKey)!;
        await this.verifyNodeBytes(context, [current.key, node.key]);
        positionMs = node.clip!.startMs;
      } else {
        if (!('positionMs' in input)) fail('INVALID');
        positionMs = input.positionMs;
        if (positionMs < current.clip!.startMs || positionMs > current.clip!.endMs) fail('INVALID');
      }
      const snapshot: Snapshot = { currentNodeKey: node.key, positionMs, revision: progress.revision + 1,
        status: node.ending && positionMs === node.clip!.endMs ? 'completed' : 'active' };
      const updated = await tx.ottPlaybackProgress.updateMany({ where: { id, ownerId, revision: progress.revision,
        manifestId: input.manifestId, currentNodeKey: input.nodeKey }, data: { ...snapshot, updatedAt: new Date() } });
      if (updated.count !== 1) fail('CONFLICT');
      await tx.ottPlaybackCommand.create({ data: { ownerId, progressId: id, idempotencyKey, kind, requestHash,
        request: input, fromRevision: progress.revision, toRevision: snapshot.revision, snapshot } });
      return this.progressProjection({ ...progress, ...snapshot }, manifest, context, locale, false,
        kind === 'choice' ? 'current_and_target' : 'not_checked');
    });
  }

  private async inspectAssets(tx: Client, ownerId: string, workId: string, graph: PlaybackGraph, strict: boolean, fullBytes: boolean) {
    const requested = new Map<string, string>();
    for (const node of graph.nodes) if (node.clip) {
      const old = requested.get(node.clip.fileId);
      if (old && old !== node.clip.mediaVersionId) fail('INVALID');
      requested.set(node.clip.fileId, node.clip.mediaVersionId);
    }
    if (requested.size > MAX_SOURCE_FILES) fail('INVALID');
    const ids = [...requested.keys()].sort(); let assets: Asset[] = []; const issues: PlaybackIssue[] = [];
    const uploads = new Map<string, Upload>();
    if (!ids.length) return { assets, issues, uploads };
    await tx.$queryRaw`SELECT id FROM ott_media_uploads WHERE owner_id=${ownerId}::uuid
      AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
    const rows = await tx.ottMediaUpload.findMany({ where: { id: { in: ids }, ownerId,
      version: { workId, work: { ownerId } } }, include: { version: true, revocation: true } });
    if (rows.length !== ids.length) fail('NOT_FOUND');
    for (const row of rows) {
      if (row.versionId !== requested.get(row.id)) fail('NOT_FOUND');
      if (row.revocation) { if (strict) fail('NOT_READY'); issues.push({ code: 'media_revoked' }); continue; }
      try {
        const upload = mapOttMediaUpload(row);
        assets.push(this.media.playbackUploadMetadata(upload)); uploads.set(row.id, upload);
      }
      catch (error) {
        if (strict || !(error instanceof HttpException)) throw error;
        issues.push({ code: 'media_unavailable' });
      }
    }
    if (fullBytes) {
      // Full graph validation is an explicit, bounded authoring operation.
      // Check the aggregate before opening even the first source object.
      if (assets.reduce((total, asset) => total + asset.sizeBytes, 0) > MAX_FULL_PLAYBACK_BYTES) fail('INVALID');
      const verified: Asset[] = [];
      for (const asset of assets) {
        try { verified.push(await this.media.inspectPlaybackUpload(uploads.get(asset.fileId)!)); }
        catch (error) {
          if (strict || !(error instanceof HttpException)) throw error;
          issues.push({ code: 'media_unavailable' });
        }
      }
      assets = verified;
    }
    return { assets, issues, uploads };
  }

  private async verifyNodeBytes(context: { graph: PlaybackGraph; uploads: Map<string, Upload> }, nodeKeys: string[]) {
    const checked = new Set<string>();
    for (const key of nodeKeys) {
      const node = context.graph.nodes.find((node) => node.key === key);
      const upload = node?.clip && context.uploads.get(node.clip.fileId);
      if (!upload) fail('NOT_READY');
      if (checked.has(upload.id)) continue;
      try { await this.media.inspectPlaybackUpload(upload); }
      catch (error) { if (error instanceof HttpException) fail('NOT_READY'); throw error; }
      checked.add(upload.id);
    }
  }

  private pin(asset: Asset): Pin {
    return { fileId: asset.fileId, mediaVersionId: asset.mediaVersionId, checksum: asset.sha256,
      durationMs: asset.durationMs, confirmationHash: asset.confirmationHash };
  }
  private checksum(graph: PlaybackGraph, pins: Pin[]) { return playbackHash({ schema: 'ott-playback-v1', graph, pins }); }
  private readinessAssets(assets: Asset[]) {
    return assets.map((asset) => ({ ...asset, subtitleLocales: asset.subtitles.map((track) => track.locale) }));
  }
  private async manifestContext(tx: Client, manifest: OttPlaybackManifest, fullBytes = false) {
    const graph = playbackGraph(manifest.graph);
    const rows = await tx.ottPlaybackAssetPin.findMany({ where: { manifestId: manifest.id }, orderBy: { fileId: 'asc' } });
    const pins = rows.map((pin) => ({ fileId: pin.fileId, mediaVersionId: pin.mediaVersionId, checksum: pin.checksum,
      durationMs: pin.durationMs, confirmationHash: pin.confirmationHash }));
    if (this.checksum(graph, pins) !== manifest.checksum) fail('NOT_READY');
    const inspected = await this.inspectAssets(tx, manifest.ownerId, manifest.workId, graph, false, fullBytes);
    for (const asset of inspected.assets) {
      const pinned = pins.find((pin) => pin.fileId === asset.fileId);
      if (!pinned || playbackHash(pinned) !== playbackHash(this.pin(asset))) fail('NOT_READY');
    }
    const readiness = graphReadiness(graph, this.readinessAssets(inspected.assets));
    if (inspected.issues.length) {
      for (const locale of LOCALES) readiness.previewReadyByLocale[locale] = false;
      readiness.fiveLocaleReady = false; readiness.issues.push(...inspected.issues);
    }
    return { graph, assets: inspected.assets, uploads: inspected.uploads, readiness };
  }
  private async manifestProjection(tx: Client, manifest: OttPlaybackManifest) {
    const context = await this.manifestContext(tx, manifest, true);
    return { manifestId: manifest.id, workId: manifest.workId, graphRevision: manifest.revision,
      checksum: manifest.checksum, graph: context.graph, readiness: context.readiness, visibility: 'private' };
  }
  private projectManifest(manifest: OttPlaybackManifest, graph: PlaybackGraph, assets: Asset[], issues: PlaybackIssue[]) {
    const readiness = graphReadiness(graph, this.readinessAssets(assets)); readiness.issues.push(...issues);
    return { manifestId: manifest.id, workId: manifest.workId, graphRevision: manifest.revision,
      checksum: manifest.checksum, graph, readiness, visibility: 'private' };
  }
  private requireReady(context: { readiness: ReturnType<typeof graphReadiness> }, locale: Locale) {
    if (!context.readiness.previewReadyByLocale[locale]) fail('NOT_READY');
  }
  private progressProjection(progress: OttPlaybackProgress, manifest: OttPlaybackManifest,
    context: { graph: PlaybackGraph; assets: Asset[] }, locale: Locale, idempotentReplay: boolean, bytes: ByteValidation) {
    const node = context.graph.nodes.find((node) => node.key === progress.currentNodeKey);
    const asset = context.assets.find((asset) => asset.fileId === node?.clip?.fileId);
    if (!node?.clip || !asset) fail('NOT_READY');
    return { progressId: progress.id, previewId: progress.previewId, manifestId: manifest.id, graphRevision: manifest.revision,
      locale, revision: progress.revision, status: progress.status, positionMs: progress.positionMs, idempotentReplay,
      visibility: 'private', source: 'authored_uploaded_clips',
      validation: { allReferencedPins: 'valid', bytes, wholeGraphBytes: 'not_checked' },
      node: { key: node.key, clip: node.clip, choices: node.choices.map((choice) => ({ key: choice.key, label: choice.label[locale]! })),
        ending: node.ending ? { key: node.ending.key, label: node.ending.label[locale]! } : null },
      subtitles: asset.subtitles.map((track) => ({ locale: track.locale, status: 'available',
        cues: track.cues.filter((cue) => cue.endMs > node.clip!.startMs && cue.startMs < node.clip!.endMs)
          .map((cue) => ({ ...cue, startMs: Math.max(cue.startMs, node.clip!.startMs), endMs: Math.min(cue.endMs, node.clip!.endMs) })) })),
      availableSubtitleLocales: asset.subtitles.map((track) => track.locale),
      browserPlayback: { sessionPath: `/api/v1/me/ott-media/files/${asset.fileId}/playback-session`, method: 'POST', mode: 'secure_http_only_cookie' },
    };
  }
  private async ownedManifest(tx: Client, ownerId: string, id: string) {
    const manifest = await tx.ottPlaybackManifest.findFirst({ where: { id, ownerId } });
    if (!manifest) fail('NOT_FOUND'); return manifest;
  }
  private async ownedProgress(tx: Client, ownerId: string, id: string) {
    const progress = await tx.ottPlaybackProgress.findFirst({ where: { id, ownerId } });
    if (!progress) fail('NOT_FOUND'); return progress;
  }
  private locale(value: unknown): Locale { if (!LOCALES.includes(value as Locale)) fail('INVALID'); return value as Locale; }
  private async lockOwner(tx: Client, ownerId: string) { await tx.$queryRaw`SELECT id FROM users WHERE id=${ownerId}::uuid FOR UPDATE`; }
  private async transaction<T>(run: (tx: Client) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(run, { timeout: 90_000, maxWait: 5_000 }); }
    catch (error) { if (error instanceof HttpException) throw error; fail('PERSISTENCE_UNAVAILABLE'); }
  }
}
