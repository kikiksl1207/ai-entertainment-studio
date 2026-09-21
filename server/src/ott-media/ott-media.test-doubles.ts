import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { ExpectedMedia, Upload, VerifiedMedia, fail } from './ott-media.contract';
import { OttMediaProbe } from './ott-media.probe';
import { OttMediaRepository, WorkVersion } from './ott-media.repository';
import { OttObjectStorage, StoredObject, sha256 } from './ott-media.storage';

// Tiny synthetic bytes are not a playable MP4. Never use this double as a media proof.
export const SAMPLE = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32000000086d646174', 'hex');
export const EXPECTED: ExpectedMedia = { sha256: sha256(SAMPLE), sizeBytes: SAMPLE.length,
  mimeType: 'video/mp4', declaredDurationMs: 1000, audioLocale: 'ko' };

export class MemoryRepository extends OttMediaRepository {
  versions = new Map<string, WorkVersion>();
  uploads = new Map<string, Upload>();
  revoked = new Set<string>();
  private tail = Promise.resolve();

  private async serial<T>(fn: () => Promise<T>) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }

  async createWork(authorId: string, _title: string) {
    const value = { workId: randomUUID(), versionId: randomUUID(), authorId, version: 1 };
    this.versions.set(value.versionId, value);
    return value;
  }

  async createVersion(ownerId: string, workId: string) {
    return this.serial(async () => {
      const versions = [...this.versions.values()].filter((v) => v.workId === workId && v.authorId === ownerId);
      if (!versions.length) fail('NOT_FOUND');
      const value = { workId, versionId: randomUUID(), authorId: ownerId, version: Math.max(...versions.map((v) => v.version)) + 1 };
      this.versions.set(value.versionId, value);
      return value;
    });
  }

  async createIntent(ownerId: string, versionId: string, key: string, expected: ExpectedMedia) {
    return this.serial(async () => {
      const version = this.versions.get(versionId);
      if (!version || version.authorId !== ownerId) fail('NOT_FOUND');
      const replay = [...this.uploads.values()].find((u) => u.ownerId === ownerId && u.intentKey === key);
      if (replay) {
        if (this.revoked.has(replay.id)) fail('NOT_READY');
        if (replay.versionId !== versionId || JSON.stringify(replay.expected) !== JSON.stringify(expected)) fail('CONFLICT');
        return cloneUpload(replay);
      }
      if ([...this.uploads.values()].some((u) => u.versionId === versionId)) fail('CONFLICT');
      const value: Upload = { id: randomUUID(), ownerId, workId: version.workId, versionId, intentKey: key,
        expected, status: 'pending_upload', expiresAt: new Date(Date.now() + 15 * 60_000), verified: null,
        subtitles: null, confirmationHash: null };
      this.uploads.set(value.id, cloneUpload(value));
      return cloneUpload(value);
    });
  }

  async withUpload<T>(ownerId: string, id: string, fn: (upload: Upload) => Promise<T>) {
    return this.serial(async () => {
      const old = this.uploads.get(id);
      if (!old || old.ownerId !== ownerId) fail('NOT_FOUND');
      if (this.revoked.has(id)) fail('NOT_READY');
      const draft = cloneUpload(old);
      const result = await fn(draft);
      this.uploads.set(id, draft);
      return result;
    });
  }

  async revoke(ownerId: string, id: string): Promise<{ fileId: string; revoked: true }> {
    return this.serial(async () => {
      const upload = this.uploads.get(id);
      if (!upload || upload.ownerId !== ownerId) fail('NOT_FOUND');
      this.revoked.add(id);
      return { fileId: id, revoked: true as const };
    });
  }
}

function cloneUpload(value: Upload): Upload {
  return { ...structuredClone(value), expiresAt: new Date(value.expiresAt.getTime()) };
}

export class MemoryStorage extends OttObjectStorage {
  bytes = new Map<string, Buffer>();
  unavailable = false;
  assertAvailable() { if (this.unavailable) fail('STORAGE_UNAVAILABLE'); }
  async put(id: string, source: Readable, expected: ExpectedMedia) {
    this.assertAvailable();
    const chunks: Buffer[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== expected.sizeBytes || sha256(bytes) !== expected.sha256) fail('OBJECT_MISMATCH');
    const old = this.bytes.get(id);
    if (old && sha256(old) !== sha256(bytes)) fail('OBJECT_MISMATCH');
    this.bytes.set(id, bytes);
  }
  async open(id: string): Promise<StoredObject> {
    this.assertAvailable();
    const bytes = this.bytes.get(id);
    if (!bytes) fail('STORAGE_UNAVAILABLE');
    return { sizeBytes: bytes.length, sha256: sha256(bytes), prefix: bytes.subarray(0, 32),
      stream: (start = 0, end = bytes.length - 1) => Readable.from([bytes.subarray(start, end + 1)]), close: async () => undefined };
  }
}

export class ProbeDouble extends OttMediaProbe {
  calls = 0;
  durationMs = 1000;
  unavailable = false;
  async inspect(media: StoredObject): Promise<VerifiedMedia> {
    this.calls++;
    if (this.unavailable) fail('PROBE_UNAVAILABLE');
    return { sha256: media.sha256, sizeBytes: media.sizeBytes, mimeType: 'video/mp4', durationMs: this.durationMs };
  }
}
