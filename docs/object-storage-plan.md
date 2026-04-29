# Object Storage Plan

Lumina Stage stores asset metadata in PostgreSQL and binary files in object storage.

## Recommended provider

Use Cloudflare R2 first.

Reasons:

- S3-compatible API, so the backend can later move to AWS S3 with minimal code changes.
- Good fit for images, thumbnails, shortform videos, premium videos, and generated character assets.
- Public delivery can be separated through a custom public base URL/CDN.

## Backend flow

1. Admin requests an upload intent.
2. Backend validates file type, size, visibility, and asset type.
3. Backend creates an `assets` row with a generated `storageKey`.
4. Backend returns a presigned `PUT` URL.
5. Admin UI uploads the file directly to object storage.
6. Admin links the asset to an artist, shortform, gift, premium video, or chat response.

Current endpoint:

```http
POST /admin/api/v1/assets/upload-intents
```

Request:

```json
{
  "assetType": "image",
  "fileName": "serin-cover.png",
  "mimeType": "image/png",
  "fileSizeBytes": 1024000,
  "visibility": "public",
  "width": 1024,
  "height": 1024,
  "metadata": {
    "usage": "artist_cover"
  }
}
```

## Environment variables

Local metadata-only mode:

```env
OBJECT_STORAGE_PROVIDER=local
```

Cloudflare R2 mode:

```env
OBJECT_STORAGE_PROVIDER=r2
OBJECT_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
OBJECT_STORAGE_BUCKET=lumina-stage-assets
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_ACCESS_KEY_ID=<r2-access-key-id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<r2-secret-access-key>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://assets.luminastage.example
OBJECT_UPLOAD_INTENT_TTL_SECONDS=900
MAX_IMAGE_UPLOAD_BYTES=20971520
MAX_VIDEO_UPLOAD_BYTES=524288000
```

AWS S3 mode:

```env
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=oneshot-ai-storage-01
OBJECT_STORAGE_REGION=ap-northeast-2
OBJECT_STORAGE_KEY_PREFIX=lumina-stage
OBJECT_STORAGE_ACCESS_KEY_ID=<aws-access-key-id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<aws-secret-access-key>
OBJECT_STORAGE_PUBLIC_BASE_URL=https://assets.luminastage.example
```

## Storage key convention

```text
uploads/{assetType}s/yyyy/mm/dd/{uuid}-{safe-file-name}
```

Examples:

- `lumina-stage/uploads/images/2026/04/28/<uuid>-serin-cover.png`
- `lumina-stage/uploads/videos/2026/04/28/<uuid>-premium-stage.mp4`

For the existing AWS bucket, use:

```env
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=oneshot-ai-storage-01
OBJECT_STORAGE_REGION=ap-northeast-2
OBJECT_STORAGE_KEY_PREFIX=lumina-stage
```

The bucket name can stay as `oneshot-ai-storage-01`. The prefix keeps Lumina Stage files separated from older service files.

## Guardrails

- Only admin API can create upload intents.
- Allowed image MIME types: `image/jpeg`, `image/png`, `image/webp`.
- Allowed video MIME types: `video/mp4`, `video/webm`, `video/quicktime`.
- Default image max: 20 MB.
- Default video max: 500 MB.
- The API creates metadata first; later we should add an upload confirmation endpoint that checks object existence before publishing.
- Public APIs must only expose uploaded/ready assets and must not expose internal `metadata`, `storageKey`, or `storageProvider`.

## Next implementation step

Add an upload confirmation endpoint:

```http
POST /admin/api/v1/assets/:assetId/confirm-upload
```

It should verify that the object exists in R2/S3, update `metadata.uploadIntent.status` to `uploaded`, and prevent unpublished broken asset links.

Current status:

- Implemented `POST /admin/api/v1/assets/:assetId/confirm-upload`.
- In `local` storage mode, confirmation marks metadata as uploaded.
- In `r2` or `s3` mode, confirmation sends a signed `HEAD` request to verify that the object exists before updating metadata.
- The endpoint writes an `asset.upload.confirm` audit event.
- Public artist and shortform APIs filter out `pending_upload` assets and return only frontend-safe asset fields.

## End-to-end verification script

The server includes a no-secret-in-repo verification script:

```bash
cd server
npm run verify:object-storage
```

Required environment variable:

```env
ADMIN_ACCESS_TOKEN=<admin access token>
```

Optional environment variables:

```env
API_BASE_URL=https://lumina-stage-api.onrender.com
TEST_FILE_PATH=C:\path\to\test-image.png
TEST_ASSET_TYPE=image
TEST_VISIBILITY=public
TEST_USAGE=object_storage_e2e
```

Default behavior:

- Creates an upload intent with a generated 1x1 PNG.
- Uploads the file to the returned presigned `PUT` URL.
- Calls `POST /admin/api/v1/assets/:assetId/confirm-upload`.
- Fetches `GET /admin/api/v1/assets/:assetId`.
- Checks the public asset URL with `HEAD` if a public URL is configured.

PowerShell example:

```powershell
$env:API_BASE_URL="https://lumina-stage-api.onrender.com"
$env:ADMIN_ACCESS_TOKEN="<admin access token>"
npm.cmd run verify:object-storage
```
