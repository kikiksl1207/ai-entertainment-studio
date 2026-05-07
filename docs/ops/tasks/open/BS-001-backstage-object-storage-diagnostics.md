# BS-001 - Backstage Object Storage Diagnostics Panel

Owner: Builder B / Frontend
Status: ready
Area: Backstage
Related: #135, #158

## Goal

Expose the backend object storage diagnostics endpoint in Backstage so upload blockers can be triaged without asking a developer to inspect server env manually.

## Read

- `docs/ops/agents.md`
- `docs/ops/board.md`
- this task file
- `backstage.html`
- `backstage.js`
- `backstage.css`

## API

```http
GET /admin/api/v1/backstage/operations/object-storage/diagnostics
Authorization: Bearer <backstageAccessToken>
```

Expected response fields include:

- `reason`
- `environment.storageProvider`
- `environment.directUploadMode`
- `environment.bucketConfigured`
- `environment.publicBaseUrlConfigured`
- `environment.accessKeyConfigured`
- `environment.secretKeyConfigured`
- `environment.expectedUploadSignedHeaders`
- `recentUserImageUploads24h.total`
- `recentUserImageUploads24h.pendingUpload`
- `recentUserImageUploads24h.uploaded`
- `recentUserImageUploads24h.failedOrUnconfirmed`
- `warnings`
- `nextActions`
- `policy.secretsReturned`

## Implementation Direction

- Add a compact Backstage operations card or diagnostics section.
- Do not show secret values.
- Show booleans as safe labels such as configured / missing.
- Highlight `reason`.
- If `policy.secretsReturned === false`, show a small safe indicator.
- Add a refresh path that uses existing Backstage auth request helpers.
- Keep UI consistent with existing Backstage panels and badges.

## Acceptance Criteria

- Backstage can fetch and render object storage diagnostics.
- No API key, secret, token, or raw env value is displayed.
- Upload operators can distinguish:
  - direct upload env incomplete
  - R2 endpoint missing
  - public URL missing
  - direct upload ready
- Existing Backstage sections still load.
- Browser console has no new uncaught errors.

## Completion

Write result to `docs/ops/inbox/builder-b.md`.
