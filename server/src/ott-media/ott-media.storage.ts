import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { BigIntStats, constants, createWriteStream } from 'fs';
import { FileHandle, link, lstat, mkdir, open, realpath, unlink } from 'fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ExpectedMedia, MAX_BYTES, fail, uuid } from './ott-media.contract';

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export interface StoredObject {
  sizeBytes: number;
  sha256: string;
  prefix: Buffer;
  stream(start?: number, end?: number): Readable;
  close(): Promise<void>;
}
export abstract class OttObjectStorage {
  abstract assertAvailable(): void;
  abstract put(id: string, source: Readable, expected: ExpectedMedia): Promise<void>;
  abstract open(id: string): Promise<StoredObject>;
}

type VerifiedFile = { sizeBytes: number; sha256: string; prefix: Buffer };
type VerificationEntry = { identity: string; expiresAt: number; result: Promise<VerifiedFile> };
const MAX_VERIFIED_FILES = 128;
const VERIFICATION_TTL_MS = 5 * 60_000;

function fileIdentity(info: BigIntStats) {
  return [info.dev, info.ino, info.nlink, info.size, info.mode,
    info.birthtimeNs, info.ctimeNs, info.mtimeNs].join(':');
}

function sameFile(before: BigIntStats, opened: BigIntStats) {
  // Windows can report dev=0 for lstat while fstat identifies the volume.
  return (before.dev === 0n || before.dev === opened.dev)
    && before.ino === opened.ino && before.nlink === opened.nlink && before.size === opened.size
    && before.mode === opened.mode && before.birthtimeNs === opened.birthtimeNs
    && before.ctimeNs === opened.ctimeNs && before.mtimeNs === opened.mtimeNs;
}

@Injectable()
export class PrivateLocalOttStorage extends OttObjectStorage {
  private readonly verifiedFiles = new Map<string, VerificationEntry>();
  constructor(private readonly config: ConfigService) { super(); }

  assertAvailable() {
    // OBJECT_STORAGE_* may serve public images; it is never a fallback for OTT.
    if (this.config.get('OTT_MEDIA_STORAGE_MODE') !== 'private_local'
      || this.config.get('OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED') !== 'true') fail('STORAGE_UNAVAILABLE');
    const root = this.config.get<string>('OTT_MEDIA_LOCAL_ROOT');
    if (!root || !isAbsolute(root) || resolve(root) === parse(resolve(root)).root) fail('STORAGE_UNAVAILABLE');
    const env = this.config.get('NODE_ENV');
    if ((env === 'production' || env === 'staging') && this.config.get('OTT_MEDIA_DURABLE_ROOT_CONFIRMED') !== 'true') fail('STORAGE_UNAVAILABLE');
    const publicRoots = this.config.get<string>('OTT_MEDIA_PUBLIC_ROOTS');
    let excluded: string[];
    try {
      excluded = JSON.parse(publicRoots ?? 'null');
      if (!Array.isArray(excluded) || excluded.some((p) => typeof p !== 'string' || !isAbsolute(p))) fail('STORAGE_UNAVAILABLE');
    } catch { fail('STORAGE_UNAVAILABLE'); }
    // Exclude the application checkout as well as explicitly inventoried static roots.
    excluded.push(process.cwd(), resolve(__dirname, '../../..'));
    const normalize = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
    const target = normalize(root);
    if (excluded.some((p) => { const e = normalize(p); return target === e || target.startsWith(`${e}${sep}`) || e.startsWith(`${target}${sep}`); })) fail('STORAGE_UNAVAILABLE');
    if (process.platform === 'win32' && !/^e:\\/.test(target)) fail('STORAGE_UNAVAILABLE');
  }

  private async root() {
    this.assertAvailable();
    const root = resolve(this.config.getOrThrow<string>('OTT_MEDIA_LOCAL_ROOT'));
    try {
      // Check every existing ancestor before mkdir: a junction above the root also escapes.
      const ancestors: string[] = [];
      for (let p = root; p !== dirname(p); p = dirname(p)) ancestors.unshift(p);
      for (const path of ancestors) {
        try { if ((await lstat(path)).isSymbolicLink()) fail('STORAGE_UNAVAILABLE'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await mkdir(root, { recursive: true, mode: 0o700 });
      for (const path of ancestors) {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) fail('STORAGE_UNAVAILABLE');
      }
      const actual = await realpath(root);
      if (actual.toLowerCase() !== root.toLowerCase()) fail('STORAGE_UNAVAILABLE');
      const info = await lstat(root);
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) fail('STORAGE_UNAVAILABLE');
      return root;
    } catch { fail('STORAGE_UNAVAILABLE'); }
  }

  async put(id: string, source: Readable, expected: ExpectedMedia) {
    uuid(id);
    const root = await this.root();
    const target = join(root, `${id}.mp4`);
    const temporary = join(root, `${randomUUID()}.pending`);
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > expected.sizeBytes || size > MAX_BYTES) return callback(new Error('byte cap'));
      hash.update(chunk);
      callback(null, chunk);
    } });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      await pipeline(source, meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: abort.signal });
      if (size !== expected.sizeBytes || hash.digest('hex') !== expected.sha256) fail('OBJECT_MISMATCH');
      const file = await open(temporary, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      await this.root();
      // A hard link is an atomic, no-replace promotion on the same private volume.
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail('STORAGE_UNAVAILABLE');
        const old = await this.open(id);
        try { if (old.sha256 !== expected.sha256 || old.sizeBytes !== expected.sizeBytes) fail('OBJECT_MISMATCH'); }
        finally { await old.close(); }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'getStatus' in error) throw error;
      fail('STORAGE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      await unlink(temporary).catch(() => undefined);
    }
  }

  async open(id: string): Promise<StoredObject> {
    uuid(id);
    const path = join(await this.root(), `${id}.mp4`);
    try {
      const before = await lstat(path, { bigint: true });
      if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n
        || before.size < 16n || before.size > BigInt(MAX_BYTES)) fail('OBJECT_MISMATCH');
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const info = await file.stat({ bigint: true });
        // The path and descriptor must name the same unchanged, single-link file.
        if (!sameFile(before, info)) fail('OBJECT_MISMATCH');
        const identity = fileIdentity(info);
        let entry = this.verifiedFiles.get(path);
        if (!entry || entry.identity !== identity || entry.expiresAt <= Date.now()) {
          const result = this.hashOpenedFile(file, info, identity);
          entry = { identity, expiresAt: Date.now() + VERIFICATION_TTL_MS, result };
          this.verifiedFiles.set(path, entry);
          if (this.verifiedFiles.size > MAX_VERIFIED_FILES) this.verifiedFiles.delete(this.verifiedFiles.keys().next().value!);
          const current = entry;
          void result.catch(() => { if (this.verifiedFiles.get(path) === current) this.verifiedFiles.delete(path); });
        } else {
          this.verifiedFiles.delete(path);
          this.verifiedFiles.set(path, entry);
        }
        const verified = await entry.result;
        if (fileIdentity(await file.stat({ bigint: true })) !== identity) fail('OBJECT_MISMATCH');
        return { sizeBytes: verified.sizeBytes, sha256: verified.sha256, prefix: Buffer.from(verified.prefix),
          stream: (start = 0, end = verified.sizeBytes - 1) => file.createReadStream({ start, end, autoClose: false }),
          close: () => file.close() };
      } catch (error) { await file.close(); throw error; }
    } catch (error) {
      if (error && typeof error === 'object' && 'getStatus' in error) throw error;
      fail('STORAGE_UNAVAILABLE');
    }
  }

  protected async hashOpenedFile(file: FileHandle, info: BigIntStats, identity: string): Promise<VerifiedFile> {
    const hash = createHash('sha256');
    let size = 0;
    let prefix = Buffer.alloc(0);
    for await (const part of file.createReadStream({ start: 0, autoClose: false, highWaterMark: 64 * 1024 })) {
      const chunk = part as Buffer;
      size += chunk.length;
      if (BigInt(size) > info.size || size > MAX_BYTES) fail('OBJECT_MISMATCH');
      if (!prefix.length) prefix = Buffer.from(chunk.subarray(0, 32));
      hash.update(chunk);
    }
    if (BigInt(size) !== info.size || fileIdentity(await file.stat({ bigint: true })) !== identity) fail('OBJECT_MISMATCH');
    return { sizeBytes: size, sha256: hash.digest('hex'), prefix };
  }
}
