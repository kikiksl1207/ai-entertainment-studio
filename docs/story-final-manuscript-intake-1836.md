# Story Final Manuscript Intake Persistence (#1836)

## Endpoint

`POST /api/v1/story-upload/intake` requires a normal authenticated user and
`multipart/form-data`.

Fields:

- `submissionType=final`
- `title`
- `originalLocale`: `ko`, `en`, `ja`, `zh-Hans`, or `zh-Hant`
- `sourceClass`: `original`, `public_domain`, or `licensed_ip`
- `rightsReference`: required only for `licensed_ip`
- `manuscripts`: MD, TXT, DOCX, PDF, or JSON
- `metadata`: JSON or CSV
- `visuals`: JPG, PNG, or WEBP

The aggregate limit is 150 MiB. Per-file category limits and content signatures
are checked before storage. At least one manuscript is required.

## Persistence

- Private object bytes are written under deterministic, retry-safe keys.
- `story_upload_submissions` stores the authenticated owner, request hashes,
  final submission metadata, status, and total bytes.
- `story_upload_submission_files` stores category, position, extension,
  checksum, size, storage provider, and private storage location.
- The audit event contains status, submission type, file count, total bytes, and
  provider name only.

The API receipt exposes only `submissionId`, `status`, `submissionType`,
`fileCount`, `totalBytes`, `replayed`, and `receivedAt`.

## Staging Verification

`npm.cmd run qa:story-upload-intake-staging` uses a disposable authenticated QA
session supplied outside source control. It sends synthetic files, verifies an
idempotent replay, and checks extension and size rejection. Output is limited to
the receipt ID, status, replay flag, file count, and PASS states.
