import { ConfigService } from '@nestjs/config';

export function buildPublicAssetUrl(
  configService: ConfigService,
  storageKey: string,
  fallback: string | null = storageKey,
) {
  if (/^https?:\/\//i.test(storageKey)) {
    return storageKey;
  }

  const baseUrl =
    configService.get<string>('OBJECT_STORAGE_PUBLIC_BASE_URL') ??
    configService.get<string>('ASSET_PUBLIC_BASE_URL');

  if (!baseUrl) {
    return fallback;
  }

  return `${baseUrl.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
}
