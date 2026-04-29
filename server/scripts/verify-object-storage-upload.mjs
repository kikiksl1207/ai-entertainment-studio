import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const defaultPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const config = {
  apiBaseUrl: env('API_BASE_URL', 'https://lumina-stage-api.onrender.com'),
  accessToken: env('ADMIN_ACCESS_TOKEN'),
  filePath: env('TEST_FILE_PATH'),
  assetType: env('TEST_ASSET_TYPE', 'image'),
  visibility: env('TEST_VISIBILITY', 'public'),
  usage: env('TEST_USAGE', 'object_storage_e2e'),
};

if (!config.accessToken) {
  fail(
    [
      'ADMIN_ACCESS_TOKEN is required.',
      'Example:',
      '  $env:API_BASE_URL="https://lumina-stage-api.onrender.com"',
      '  $env:ADMIN_ACCESS_TOKEN="<admin access token>"',
      '  npm.cmd run verify:object-storage',
    ].join('\n'),
  );
}

const file = await loadTestFile(config.filePath);
const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');

logStep('Create upload intent');
const uploadIntent = await apiJson(`${apiBaseUrl}/admin/api/v1/assets/upload-intents`, {
  method: 'POST',
  body: {
    assetType: config.assetType,
    fileName: file.fileName,
    mimeType: file.mimeType,
    fileSizeBytes: file.bytes.length,
    visibility: config.visibility,
    width: file.mimeType.startsWith('image/') ? 1 : undefined,
    height: file.mimeType.startsWith('image/') ? 1 : undefined,
    metadata: {
      usage: config.usage,
      verification: {
        source: 'scripts/verify-object-storage-upload.mjs',
        createdAt: new Date().toISOString(),
      },
    },
  },
});

const assetId = uploadIntent?.asset?.id;
const upload = uploadIntent?.upload;

if (!assetId || !upload?.url) {
  fail(`Upload intent response did not include asset.id and upload.url:\n${json(uploadIntent)}`);
}

logStep(`PUT test object to storage (${upload.storageProvider})`);
const putResponse = await fetch(upload.url, {
  method: upload.method ?? 'PUT',
  headers: upload.requiredHeaders ?? { 'content-type': file.mimeType },
  body: file.bytes,
});

if (!putResponse.ok) {
  fail(`Storage PUT failed: ${putResponse.status} ${putResponse.statusText}\n${await putResponse.text()}`);
}

logStep('Confirm upload');
const confirmed = await apiJson(`${apiBaseUrl}/admin/api/v1/assets/${assetId}/confirm-upload`, {
  method: 'POST',
  body: {
    objectETag: trimHeader(putResponse.headers.get('etag')),
  },
});

if (confirmed?.upload?.status !== 'uploaded') {
  fail(`Confirm response did not mark upload as uploaded:\n${json(confirmed)}`);
}

logStep('Fetch asset lookup');
const asset = await apiJson(`${apiBaseUrl}/admin/api/v1/assets/${assetId}`);

if (asset?.uploadStatus !== 'uploaded') {
  fail(`Asset lookup did not return uploadStatus=uploaded:\n${json(asset)}`);
}

if (asset?.url) {
  logStep('Check public asset URL');
  const publicResponse = await fetch(asset.url, { method: 'HEAD' });

  if (!publicResponse.ok) {
    fail(`Public asset URL check failed: ${publicResponse.status} ${publicResponse.statusText}`);
  }
}

console.log(
  json({
    ok: true,
    assetId,
    storageProvider: asset.storageProvider,
    storageKey: asset.storageKey,
    url: asset.url,
    uploadStatus: asset.uploadStatus,
  }),
);

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

async function loadTestFile(filePath) {
  if (!filePath) {
    return {
      bytes: defaultPng,
      fileName: `lumina-storage-e2e-${Date.now()}.png`,
      mimeType: 'image/png',
    };
  }

  const bytes = await readFile(filePath);
  const fileName = basename(filePath);
  const mimeType = mimeTypeFromExtension(extname(fileName));

  return { bytes, fileName, mimeType };
}

function mimeTypeFromExtension(extension) {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    default:
      fail(`Unsupported TEST_FILE_PATH extension: ${extension}`);
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(removeUndefined(options.body)) : undefined,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    fail(`API request failed: ${options.method ?? 'GET'} ${url}\n${response.status} ${response.statusText}\n${json(body)}`);
  }

  return body;
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([entryKey, entryValue]) => [entryKey, removeUndefined(entryValue)]),
    );
  }

  return value;
}

function trimHeader(value) {
  return value?.replace(/^"|"$/g, '') ?? undefined;
}

function logStep(message) {
  console.error(`==> ${message}`);
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
