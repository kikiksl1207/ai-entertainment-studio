import { createHash, createHmac } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type StoryUploadStorageProvider = 'local' | 'r2' | 's3';

@Injectable()
export class StoryUploadStorageService {
  constructor(private readonly configService: ConfigService) {}

  provider(): StoryUploadStorageProvider {
    const provider =
      this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    if (provider !== 'local' && provider !== 'r2' && provider !== 's3') {
      throw this.storageUnavailable();
    }
    return provider;
  }

  async putObject(input: {
    storageKey: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ storageProvider: StoryUploadStorageProvider }> {
    const storageProvider = this.provider();
    this.assertStorageModeAllowed(storageProvider);
    this.assertStorageKey(input.storageKey);

    if (storageProvider === 'local') {
      await this.putLocalObject(input.storageKey, input.buffer);
      return { storageProvider };
    }

    const uploadUrl = this.buildSignedUrl(
      storageProvider,
      input.storageKey,
      'PUT',
      input.mimeType,
      300,
    );
    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': input.mimeType },
        body: input.buffer as unknown as BodyInit,
      });
    } catch {
      throw this.storageUnavailable();
    }
    if (!uploadResponse.ok) {
      throw this.storageUnavailable();
    }

    const verifyUrl = this.buildSignedUrl(
      storageProvider,
      input.storageKey,
      'HEAD',
      undefined,
      60,
    );
    let verifyResponse: Response;
    try {
      verifyResponse = await fetch(verifyUrl, { method: 'HEAD' });
    } catch {
      throw this.storageUnavailable();
    }
    if (!verifyResponse.ok) {
      throw this.storageUnavailable();
    }
    const contentLength = Number(verifyResponse.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength >= 0 &&
      contentLength !== input.buffer.length
    ) {
      throw this.storageUnavailable();
    }

    return { storageProvider };
  }

  private assertStorageModeAllowed(provider: StoryUploadStorageProvider) {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    if ((nodeEnv === 'production' || nodeEnv === 'staging') && provider === 'local') {
      throw this.storageUnavailable();
    }
  }

  private async putLocalObject(storageKey: string, buffer: Buffer) {
    const configuredRoot =
      this.configService.get<string>('STORY_UPLOAD_LOCAL_STORAGE_ROOT') ??
      'storage/private-story-upload';
    const root = resolve(configuredRoot);
    const target = resolve(root, storageKey);
    if (!target.startsWith(`${root}${sep}`)) {
      throw new BadRequestException({
        code: 'STORY_UPLOAD_STORAGE_KEY_INVALID',
        messageKey: 'storyUpload.intake.storageKeyInvalid',
      });
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    const written = await stat(target);
    if (written.size !== buffer.length) {
      throw this.storageUnavailable();
    }
  }

  private assertStorageKey(storageKey: string) {
    if (
      !storageKey ||
      storageKey.startsWith('/') ||
      storageKey.includes('..') ||
      !/^[a-z0-9/_.-]+$/.test(storageKey)
    ) {
      throw new BadRequestException({
        code: 'STORY_UPLOAD_STORAGE_KEY_INVALID',
        messageKey: 'storyUpload.intake.storageKeyInvalid',
      });
    }
  }

  private buildSignedUrl(
    provider: Exclude<StoryUploadStorageProvider, 'local'>,
    storageKey: string,
    method: 'PUT' | 'HEAD',
    mimeType: string | undefined,
    expiresInSeconds: number,
  ) {
    const bucket = this.requiredConfig('OBJECT_STORAGE_BUCKET');
    const region =
      this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.requiredConfig('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.requiredConfig(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    );
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.objectStorageEndpoint(provider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const signedHeaders = method === 'PUT' ? 'content-type;host' : 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const headers =
      method === 'PUT'
        ? `content-type:${mimeType}\nhost:${url.host}\n`
        : `host:${url.host}\n`;
    const canonicalRequest = [
      method,
      this.canonicalUri(url.pathname),
      canonicalQuery,
      headers,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private objectStorageEndpoint(
    provider: Exclude<StoryUploadStorageProvider, 'local'>,
    bucket: string,
    region: string,
  ) {
    const configured = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');
    if (configured) {
      return `${configured.replace(/\/+$/, '')}/${bucket}`;
    }
    if (provider === 's3') {
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    }
    throw this.storageUnavailable();
  }

  private joinUrlPath(baseUrl: string, storageKey: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${storageKey
      .split('/')
      .map((part) => this.rfc3986Encode(part))
      .join('/')}`;
  }

  private canonicalUri(pathname: string) {
    return pathname
      .split('/')
      .map((part) => this.rfc3986Encode(decodeURIComponent(part)))
      .join('/');
  }

  private canonicalQueryString(query: Record<string, string>) {
    return Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          `${this.rfc3986Encode(key)}=${this.rfc3986Encode(value)}`,
      )
      .join('&');
  }

  private rfc3986Encode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private signingKey(
    secretAccessKey: string,
    dateStamp: string,
    region: string,
    service: string,
  ) {
    const dateKey = this.hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = this.hmacBuffer(dateKey, region);
    const dateRegionServiceKey = this.hmacBuffer(dateRegionKey, service);
    return this.hmacBuffer(dateRegionServiceKey, 'aws4_request');
  }

  private hmacBuffer(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest();
  }

  private hmacHex(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private requiredConfig(key: string) {
    const value = this.configService.get<string>(key);
    if (!value) throw this.storageUnavailable();
    return value;
  }

  private storageUnavailable() {
    return new ServiceUnavailableException({
      code: 'STORY_UPLOAD_STORAGE_UNAVAILABLE',
      messageKey: 'storyUpload.intake.storageUnavailable',
    });
  }
}
