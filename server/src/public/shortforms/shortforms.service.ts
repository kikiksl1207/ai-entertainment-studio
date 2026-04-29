import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShortformsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const shortforms = await this.prisma.shortform.findMany({
      where: { status: 'published' },
      include: publicShortformInclude,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return shortforms.map((shortform) => this.toPublicShortform(shortform));
  }

  async findBySlug(slug: string) {
    const shortform = await this.prisma.shortform.findFirst({
      where: { slug, status: 'published' },
      include: publicShortformInclude,
    });

    return shortform ? this.toPublicShortform(shortform) : null;
  }

  private toPublicShortform(shortform: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    artist: { id: string; slug: string; displayName: string } | null;
    assets: Array<{
      role: string;
      sortOrder: number;
      asset: {
        id: string;
        assetType: string;
        storageProvider: string;
        storageKey: string;
        mimeType: string;
        width: number | null;
        height: number | null;
        metadata: unknown;
      };
    }>;
  }) {
    const assets = shortform.assets
      .filter((shortformAsset) => this.isPublicReadyAsset(shortformAsset.asset.metadata))
      .map((shortformAsset) => ({
        id: shortformAsset.asset.id,
        role: shortformAsset.role,
        assetType: shortformAsset.asset.assetType,
        url: this.assetUrl(shortformAsset.asset.storageKey),
        mimeType: shortformAsset.asset.mimeType,
        width: shortformAsset.asset.width,
        height: shortformAsset.asset.height,
        sortOrder: shortformAsset.sortOrder,
      }));
    const thumbnail = assets.find((asset) => asset.role === 'thumbnail') ?? assets[0] ?? null;

    return {
      id: shortform.id,
      slug: shortform.slug,
      title: shortform.title,
      description: shortform.description,
      status: shortform.status,
      publishedAt: shortform.publishedAt,
      artist: shortform.artist,
      thumbnail,
      assets,
      createdAt: shortform.createdAt,
      updatedAt: shortform.updatedAt,
    };
  }

  private assetUrl(storageKey: string) {
    const baseUrl =
      this.configService.get<string>('ASSET_PUBLIC_BASE_URL') ??
      this.configService.get<string>('OBJECT_STORAGE_PUBLIC_BASE_URL');

    if (!baseUrl) {
      return storageKey;
    }

    return `${baseUrl.replace(/\/+$/, '')}/${storageKey}`;
  }

  private isPublicReadyAsset(metadata: unknown) {
    if (!this.isRecord(metadata)) {
      return true;
    }

    const uploadIntent = metadata.uploadIntent;
    const lifecycle = metadata.lifecycle;

    if (this.isRecord(lifecycle) && lifecycle.status === 'archived') {
      return false;
    }

    if (!this.isRecord(uploadIntent)) {
      return true;
    }

    return uploadIntent.status === 'uploaded';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

const publicShortformInclude = {
  artist: {
    select: {
      id: true,
      slug: true,
      displayName: true,
    },
  },
  assets: {
    where: {
      asset: {
        visibility: 'public' as const,
      },
    },
    include: {
      asset: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
};
