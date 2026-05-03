# Render Operations

Lumina Stage backend is deployed as a Render Web Service from the `server/` directory.

## Normal deployment

Use this for regular deploys after the production database already has seed data.

Build command:

```bash
npm install && npm run prisma:generate && npm run build
```

Start command:

```bash
npm run render:start
```

This runs pending Prisma migrations and starts the compiled NestJS app with `node dist/main.js`.

## One-time seed deployment

Use this only when the production database needs the initial public content seed.

Temporary start command:

```bash
npm run render:start:seed
```

After the deploy becomes live and public API data is confirmed, change the start command back to:

```bash
npm run render:start
```

The seed script is designed to be idempotent for MVP content, so re-running it should update known seed records instead of creating duplicate artists.

### Selective artist seed

Use this when only newly finalized character images or artist profile records need to be refreshed.

1. Add a temporary Render environment variable:

```text
SEED_ARTIST_SLUGS=kwon-taejun
```

For multiple artists, use comma-separated slugs:

```text
SEED_ARTIST_SLUGS=kwon-taejun,choi-seojin
```

2. Temporarily change the start command to:

```bash
npm run render:start:seed
```

3. After the deploy becomes live and the public API is confirmed, remove `SEED_ARTIST_SLUGS` and change the start command back to:

```bash
npm run render:start
```

Do not keep selective seed variables on permanently. They are an operations tool for one-time production refreshes.

## Verification URLs

Production domains:

```text
Frontend: https://lumina-stage.com
Frontend alias: https://www.lumina-stage.com
Backend API: https://api.lumina-stage.com
```

Health:

```text
https://api.lumina-stage.com/health
```

Public artists:

```text
https://api.lumina-stage.com/api/v1/artists
```

Render fallback URLs remain usable for incident checks:

```text
https://lumina-stage-api.onrender.com/health
https://lumina-stage-api.onrender.com/api/v1/artists
```

Expected initial public artist slugs:

- `yoon-serin`
- `han-seoyul`
- `park-doa`
- `choi-seojin`
- `oh-hyerin`
- `cha-dohyun`
- `seo-yuan`
- `kwon-taejun`

## Notes

- Render web service and Postgres should stay on paid instances for stable API wake time and database retention.
- Do not keep `render:start:seed` as the permanent start command. It adds unnecessary startup work and can overwrite seed-managed copy.
- Public detail profile facts are stored under `publicProfile.publicMetadata.profileFacts` in the API response.
- Production `CORS_ORIGINS` should include `https://lumina-stage.com`, `https://www.lumina-stage.com`, the Vercel fallback URL, and local QA origins only.

## Production credential rotation

Rotate the Render Postgres credential after any database URL, password, or connection string is exposed in chat, screenshots, logs, or external documents.

Recommended order:

1. Open Render dashboard.
2. Open the `lumina-stage-db` Postgres instance.
3. Create a new database credential if Render supports multiple credentials for the instance.
4. Copy the new Internal Database URL.
5. Open the `lumina-stage-api` Web Service.
6. Go to Environment.
7. Replace `DATABASE_URL` with the new Internal Database URL.
8. Save and redeploy.
9. Wait until the deploy is live.
10. Verify the API.

Verification:

```text
https://api.lumina-stage.com/health
https://api.lumina-stage.com/api/v1/artists
```

If both URLs respond successfully, revoke or delete the old database credential in Render.

If Render only allows password rotation instead of multiple credentials:

1. Rotate/regenerate the password in the Postgres instance.
2. Immediately update `DATABASE_URL` on the Web Service.
3. Redeploy.
4. Verify the API.

Do not paste the new database URL into GitHub, Notion, chat, screenshots, or local documents. Store it only in Render environment variables and a trusted password manager if needed.

Rollback rule:

- If the new deploy fails because of database authentication, restore the previous `DATABASE_URL` only inside Render Environment and redeploy.
- Do not commit either old or new database URLs to the repository.
