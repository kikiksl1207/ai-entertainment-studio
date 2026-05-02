import { createHash, createHmac, randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

type UserAssetBody = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class UserAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createUploadIntent(userId: string, input: UserAssetBody) {
    const mimeType = this.allowedImageMimeType(this.string(input, 'mimeType'));
    const fileName = this.safeFileName(this.string(input, 'fileName'));
    const fileSizeBytes = this.imageFileSizeBytes(input);
    const storageProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const storageKey = this.buildStorageKey(fileName);
    const expiresInSeconds = this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900);
    const uploadUrl = this.buildUploadUrl(storageProvider, storageKey, expiresInSeconds);
    const publicUrl = buildPublicAssetUrl(this.configService, storageKey, null);

    const asset = await this.prisma.asset.create({
      data: {
        assetType: 'image',
        visibility: 'public',
        storageProvider,
        storageKey,
        mimeType,
        fileSizeBytes,
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.toJson({
          uploadIntent: {
            status: 'pending_upload',
            scope: 'user_image',
            createdByUserId: userId,
            fileName,
            createdAt: new Date().toISOString(),
          },
        }),
      },
    });

    return {
      asset: this.presentAsset(asset),
      upload: {
        method: 'PUT',
        url: uploadUrl,
        publicUrl,
        storageProvider,
        storageKey,
        requiredHeaders: {
          'content-type': mimeType,
        },
        expiresInSeconds,
        mode: storageProvider === 'local' ? 'metadata_only' : 'direct_upload_ready',
      },
    };
  }

  async confirmUpload(userId: string, assetId: string, input: UserAssetBody) {
    if (!UUID_PATTERN.test(assetId)) {
      throw new BadRequestException('assetId must be a UUID');
    }

    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);

    if (uploadIntent.createdByUserId !== userId) {
      throw new ForbiddenException('Asset owner access is required');
    }

    await this.assertObjectUploaded(asset.storageProvider, asset.storageKey);

    const confirmedAt = new Date().toISOString();
    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson({
          ...metadata,
          uploadIntent: {
            ...uploadIntent,
            status: 'uploaded',
            confirmedByUserId: userId,
            confirmedAt,
            objectETag: this.optionalString(input, 'objectETag'),
          },
        }),
        updatedAt: new Date(),
      },
    });

    return {
      asset: this.presentAsset(updatedAsset),
      upload: {
        status: 'uploaded',
        confirmedAt,
        publicUrl: buildPublicAssetUrl(this.configService, updatedAsset.storageKey, null),
      },
    };
  }

  private presentAsset(asset: {
    id: string;
    assetType: string;
    visibility: string;
    storageProvider: string;
    storageKey: string;
    mimeType: string;
    fileSizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    return {
      id: asset.id,
      assetType: asset.assetType,
      visibility: asset.visibility,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      url: buildPublicAssetUrl(this.configService, asset.storageKey, null),
      thumbnailUrl: buildPublicAssetUrl(this.configService, asset.storageKey, null),
      uploadStatus:
        typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready',
      lifecycleStatus:
        typeof lifecycle.status === 'string' ? lifecycle.status : 'active',
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }

  private allowedImageMimeType(mimeType: string) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

    if (!allowed.has(mimeType)) {
      throw new BadRequestException('mimeType must be image/jpeg, image/png, image/webp, or image/gif');
    }

    return mimeType;
  }

  private imageFileSizeBytes(input: UserAssetBody) {
    const size = this.number(input, 'fileSizeBytes');
    const maxSize = this.numberFromEnv('MAX_IMAGE_UPLOAD_BYTES', 20_971_520);

    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException('fileSizeBytes must be a positive integer');
    }

    if (size > maxSize) {
      throw new BadRequestException(`fileSizeBytes must be less than or equal to ${maxSize}`);
    }

    return BigInt(size);
  }

  private safeFileName(fileName: string) {
    const cleaned = fileName
      .normalize('NFKD')
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase();

    if (!cleaned || !cleaned.includes('.')) {
      throw new BadRequestException('fileName must include a safe extension');
    }

    return cleaned.slice(0, 120);
  }

  private buildStorageKey(fileName: string) {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const prefix = this.storageKeyPrefix();
    const path = `uploads/user-images/${yyyy}/${mm}/${dd}/${randomUUID()}-${fileName}`;

    return prefix ? `${prefix}/${path}` : path;
  }

  private buildUploadUrl(storageProvider: string, storageKey: string, expiresInSeconds: number) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(storageProvider, storageKey, expiresInSeconds);
    }

    if (storageProvider !== 'local') {
      throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
    }

    return `/pending-local-upload/${storageKey}`;
  }

  private async assertObjectUploaded(storageProvider: string, storageKey: string) {
    if (storageProvider === 'local') {
      return;
    }

    if (storageProvider === 'r2' || storageProvider === 's3') {
      const response = await fetch(
        this.buildS3CompatibleSignedHeadUrl(storageProvider, storageKey),
        { method: 'HEAD' },
      );

      if (response.status === 404) {
        throw new BadRequestException('Uploaded object was not found in storage');
      }

      if (!response.ok) {
        throw new BadRequestException('Could not verify uploaded object');
      }

      return;
    }

    throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
  }

  private buildS3CompatiblePresignedPutUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
  ) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'PUT',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
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

  private buildS3CompatibleSignedHeadUrl(storageProvider: string, storageKey: string) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '60',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'HEAD',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
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

  private buildObjectStorageEndpoint(storageProvider: string, bucket: string, region: string) {
    const configuredEndpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');

    if (configuredEndpoint) {
      return `${configuredEndpoint.replace(/\/+$/, '')}/${bucket}`;
    }

    if (storageProvider === 's3') {
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    }

    throw new BadRequestException('OBJECT_STORAGE_ENDPOINT is required for r2 storage');
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
      .map(([key, value]) => `${this.rfc3986Encode(key)}=${this.rfc3986Encode(value)}`)
      .join('&');
  }

  private rfc3986Encode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
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

  private envString(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new BadRequestException(`${key} environment variable is required`);
    }

    return value;
  }

  private storageKeyPrefix() {
    const value = this.configService.get<string>('OBJECT_STORAGE_KEY_PREFIX');

    if (!value) {
      return '';
    }

    return value
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/')
      .split('/')
      .map((part) =>
        part
          .normalize('NFKD')
          .replace(/[^\w.\-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-.]+|[-.]+$/g, '')
          .toLowerCase(),
      )
      .filter(Boolean)
      .join('/');
  }

  private numberFromEnv(key: string, fallback: number) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new BadRequestException(`${key} must be a positive number`);
    }

    return parsed;
  }

  private string(input: UserAssetBody, key: string) {
    const value = input[key];

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: UserAssetBody, key: string) {
    const value = input[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private number(input: UserAssetBody, key: string) {
    const value = Number(input[key]);

    if (!Number.isFinite(value)) {
      throw new BadRequestException(`${key} must be a number`);
    }

    return value;
  }

  private optionalNumber(input: UserAssetBody, key: string) {
    return input[key] === undefined ? undefined : this.number(input, key);
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as UserAssetBody)
      : {};
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
