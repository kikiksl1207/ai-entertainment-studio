import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Upload, fail } from './ott-media.contract';

@Injectable()
export class OttMediaDelivery {
  constructor(private readonly config: ConfigService) {}

  assertAvailable() { this.key(); }

  assertBrowserOrigin(origin: unknown, required: boolean, fetchSite?: unknown) {
    if (fetchSite === 'cross-site') fail('TOKEN_INVALID');
    const value = this.config.get<string>('OTT_MEDIA_BROWSER_ORIGINS');
    let allowed: string[];
    try {
      allowed = JSON.parse(value ?? 'null');
      if (!Array.isArray(allowed) || !allowed.length || allowed.some((item) => {
        const url = new URL(item);
        return url.protocol !== 'https:' || url.origin !== item || Boolean(url.username || url.password);
      })) fail('STORAGE_UNAVAILABLE');
    } catch { fail('STORAGE_UNAVAILABLE'); }
    if (origin === undefined && !required) return;
    if (typeof origin !== 'string' || !allowed.includes(origin)) fail('TOKEN_INVALID');
  }

  private key() {
    const key = this.config.get<string>('OTT_MEDIA_DELIVERY_SECRET');
    if (!key || Buffer.byteLength(key) < 32) fail('STORAGE_UNAVAILABLE');
    return key;
  }

  private signature(upload: Upload, expires: number) {
    return createHmac('sha256', this.key()).update(JSON.stringify([
      'ott-private-preview-v1', upload.ownerId, upload.workId, upload.versionId, upload.id,
      upload.verified?.sha256, expires,
    ])).digest('base64url');
  }

  issue(upload: Upload) {
    const expires = Math.floor(Date.now() / 1000) + 60;
    return { path: `/api/v1/me/ott-media/files/${upload.id}/delivery`,
      headers: { 'x-ott-expires': String(expires), 'x-ott-signature': this.signature(upload, expires) },
      expiresAt: new Date(expires * 1000).toISOString(), authorization: 'bearer-required' as const };
  }

  issueBrowserSession(upload: Upload) {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(this.key()).digest(), iv);
    cipher.setAAD(Buffer.from('ott-browser-preview-v1'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ownerId: upload.ownerId,
      fileId: upload.id, versionId: upload.versionId, checksum: upload.verified!.sha256, expires })), cipher.final()]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    const path = this.browserPath(upload.id);
    return { path, expiresAt: new Date(expires * 1000).toISOString(),
      cookie: `__Secure-ott-preview=${token}; Path=${path}; Max-Age=60; HttpOnly; Secure; SameSite=Strict` };
  }

  browserPath(fileId: string) { return `/api/v1/ott-media/private-files/${fileId}/delivery`; }

  readBrowserSession(cookie: unknown, fileId: string): BrowserGrant {
    if (typeof cookie !== 'string' || cookie.length > 8192) fail('TOKEN_INVALID');
    const matches = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith('__Secure-ott-preview='));
    if (matches.length !== 1) fail('TOKEN_INVALID');
    const token = matches[0].slice('__Secure-ott-preview='.length);
    if (!/^[A-Za-z0-9_-]{60,1024}$/.test(token)) fail('TOKEN_INVALID');
    try {
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.toString('base64url') !== token) fail('TOKEN_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(this.key()).digest(), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from('ott-browser-preview-v1'));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const grant: BrowserGrant = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (grant.fileId !== fileId || typeof grant.ownerId !== 'string' || typeof grant.versionId !== 'string'
        || typeof grant.checksum !== 'string' || !Number.isSafeInteger(grant.expires)
        || grant.expires <= now || grant.expires > now + 60) fail('TOKEN_INVALID');
      return grant;
    } catch { fail('TOKEN_INVALID'); }
  }

  verify(upload: Upload, expiresInput: unknown, signature: unknown) {
    if (typeof expiresInput !== 'string' || !/^\d{10}$/.test(expiresInput)
      || typeof signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signature)) fail('TOKEN_INVALID');
    const expires = Number(expiresInput);
    const now = Math.floor(Date.now() / 1000);
    if (expires <= now || expires > now + 60) fail('TOKEN_INVALID');
    const expected = this.signature(upload, expires);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('TOKEN_INVALID');
  }
}

export type BrowserGrant = { ownerId: string; fileId: string; versionId: string; checksum: string; expires: number };
