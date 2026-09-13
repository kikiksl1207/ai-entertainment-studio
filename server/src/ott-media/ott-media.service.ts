import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { MAX_DURATION_MS, Upload, expectedMedia, fail, intentKey, object, subtitles, uuid } from './ott-media.contract';
import { BrowserGrant, OttMediaDelivery } from './ott-media.delivery';
import { OttMediaProbe, verifyObject } from './ott-media.probe';
import { OttMediaRepository } from './ott-media.repository';
import { OttObjectStorage, StoredObject, sha256 } from './ott-media.storage';

@Injectable()
export class OttMediaService {
  constructor(private readonly repository: OttMediaRepository, private readonly storage: OttObjectStorage,
    private readonly probe: OttMediaProbe, private readonly delivery: OttMediaDelivery) {}

  createWork(ownerId: string, body: unknown) {
    const value = object(body, ['title']);
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) fail('INVALID');
    return this.repository.createWork(uuid(ownerId), value.title.trim());
  }

  createVersion(ownerId: string, workId: string, body: unknown) {
    object(body, []);
    return this.repository.createVersion(uuid(ownerId), uuid(workId));
  }

  async createIntent(ownerId: string, versionId: string, key: unknown, body: unknown) {
    const expected = expectedMedia(body);
    this.storage.assertAvailable();
    this.delivery.assertAvailable();
    const upload = await this.repository.createIntent(uuid(ownerId), uuid(versionId), intentKey(key), expected);
    if (upload.status !== 'confirmed') this.assertUnexpired(upload);
    return { ...this.project(upload), upload: upload.status === 'pending_upload' ? {
      method: 'PUT', path: `/api/v1/me/ott-media/files/${upload.id}/object`, contentType: expected.mimeType,
      expiresAt: upload.expiresAt.toISOString(), authorization: 'bearer-required', maxBytes: expected.sizeBytes,
    } : null };
  }

  async uploadObject(ownerId: string, id: string, source: Readable, contentType: string | undefined) {
    if (contentType !== 'video/mp4') fail('INVALID');
    return this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => {
      if (upload.status !== 'confirmed') this.assertUnexpired(upload);
      await this.storage.put(upload.id, source, upload.expected);
      this.assertUnexpiredUnlessConfirmed(upload);
      if (upload.status === 'pending_upload') upload.status = 'uploaded';
      return this.project(upload);
    });
  }

  async confirm(ownerId: string, id: string, body: unknown) {
    const value = object(body, ['subtitles']);
    return this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => {
      const tracks = subtitles(value.subtitles, upload.verified?.durationMs ?? MAX_DURATION_MS);
      const confirmationHash = sha256(JSON.stringify(tracks));
      if (upload.status === 'confirmed') {
        if (upload.confirmationHash !== confirmationHash) fail('CONFLICT');
        const media = await this.storage.open(upload.id);
        try { this.assertConfirmedObject(upload, media); } finally { await media.close(); }
        return this.project(upload);
      }
      this.assertUnexpired(upload);
      if (upload.status !== 'uploaded') fail('NOT_READY');
      const media = await this.storage.open(upload.id);
      try {
        verifyObject(media, upload.expected);
        const verified = await this.probe.inspect(media, upload.expected);
        // The probe contract remains fail-closed when a future adapter returns unknown data.
        if (!verified || verified.sha256 !== media.sha256 || verified.sizeBytes !== media.sizeBytes
          || verified.mimeType !== 'video/mp4' || !Number.isSafeInteger(verified.durationMs) || verified.durationMs <= 0 || verified.durationMs > MAX_DURATION_MS
          || Math.abs(verified.durationMs - upload.expected.declaredDurationMs) > 250) fail('OBJECT_MISMATCH');
        subtitles(tracks, verified.durationMs);
        this.assertUnexpired(upload);
        upload.status = 'confirmed';
        upload.verified = verified;
        upload.subtitles = tracks;
        upload.confirmationHash = confirmationHash;
        return this.project(upload);
      } finally { await media.close(); }
    });
  }

  getFile(ownerId: string, id: string) {
    return this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => this.project(upload));
  }

  preview(ownerId: string, id: string) {
    return this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => {
      this.assertConfirmed(upload);
      const media = await this.storage.open(upload.id);
      try { this.assertConfirmedObject(upload, media); } finally { await media.close(); }
      return { ...this.project(upload), playback: { ...this.delivery.issue(upload), mode: 'api_headers' },
        browserPlayback: { sessionPath: `/api/v1/me/ott-media/files/${upload.id}/playback-session`, method: 'POST', mode: 'secure_http_only_cookie', requires: 'same-site HTTPS' },
        subtitles: (upload.subtitles ?? []).map((track) => ({ ...track, format: 'json-cues', status: 'available' })),
        availableSubtitleLocales: (upload.subtitles ?? []).map((track) => track.locale),
        choices: [], choicePolicy: { maxRecommendations: 3, directInput: 'deferred', routing: 'not_implemented' } };
    });
  }

  browserSession(ownerId: string, id: string, body: unknown) {
    object(body, []);
    return this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => {
      this.assertConfirmed(upload);
      const media = await this.storage.open(upload.id);
      try { this.assertConfirmedObject(upload, media); } finally { await media.close(); }
      return this.delivery.issueBrowserSession(upload);
    });
  }

  async deliverBrowser(grant: BrowserGrant) {
    let opened: StoredObject | undefined;
    try {
      return await this.repository.withUpload(uuid(grant.ownerId), uuid(grant.fileId), async (upload) => {
        this.assertConfirmed(upload);
        if (upload.versionId !== grant.versionId || upload.verified!.sha256 !== grant.checksum
          || grant.expires <= Math.floor(Date.now() / 1000)) fail('TOKEN_INVALID');
        opened = await this.storage.open(upload.id);
        this.assertConfirmedObject(upload, opened);
        return opened;
      });
    } catch (error) { await opened?.close(); throw error; }
  }

  async deliver(ownerId: string, id: string, expires: unknown, signature: unknown) {
    let opened: StoredObject | undefined;
    try { return await this.repository.withUpload(uuid(ownerId), uuid(id), async (upload) => {
      this.assertConfirmed(upload);
      this.delivery.verify(upload, expires, signature);
      opened = await this.storage.open(upload.id);
      this.assertConfirmedObject(upload, opened);
      return opened;
    }); } catch (error) { await opened?.close(); throw error; }
  }

  private assertConfirmed(upload: Upload) {
    if (upload.status !== 'confirmed' || !upload.verified || !upload.confirmationHash || !upload.subtitles) fail('NOT_READY');
    const media = upload.verified;
    if (media.sha256 !== upload.expected.sha256 || media.sizeBytes !== upload.expected.sizeBytes || media.mimeType !== 'video/mp4'
      || !Number.isSafeInteger(media.durationMs) || media.durationMs <= 0 || media.durationMs > MAX_DURATION_MS
      || Math.abs(media.durationMs - upload.expected.declaredDurationMs) > 250) fail('NOT_READY');
    const tracks = subtitles(upload.subtitles, media.durationMs);
    if (sha256(JSON.stringify(tracks)) !== upload.confirmationHash) fail('NOT_READY');
  }

  private assertConfirmedObject(upload: Upload, media: { sha256: string; sizeBytes: number }) {
    this.assertConfirmed(upload);
    if (media.sha256 !== upload.verified!.sha256 || media.sizeBytes !== upload.verified!.sizeBytes) fail('OBJECT_MISMATCH');
  }

  private assertUnexpired(upload: Upload) {
    if (!(upload.expiresAt instanceof Date) || !Number.isFinite(upload.expiresAt.getTime()) || upload.expiresAt.getTime() <= Date.now()) fail('EXPIRED');
  }

  private assertUnexpiredUnlessConfirmed(upload: Upload) { if (upload.status !== 'confirmed') this.assertUnexpired(upload); }

  private project(upload: Upload) {
    return { fileId: upload.id, authorId: upload.ownerId, workId: upload.workId, versionId: upload.versionId,
      status: upload.status, source: 'user_provided_original', visibility: 'private',
      audio: { locale: 'ko', verification: 'uploader_declared_not_language_detected' },
      media: upload.status === 'confirmed' && upload.verified ? {
        durationMs: upload.verified.durationMs, sizeBytes: upload.verified.sizeBytes, mimeType: upload.verified.mimeType,
      } : null };
  }
}
