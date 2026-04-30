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

## Notes

- Render web service and Postgres should stay on paid instances for stable API wake time and database retention.
- Do not keep `render:start:seed` as the permanent start command. It adds unnecessary startup work and can overwrite seed-managed copy.
- Public detail profile facts are stored under `publicProfile.publicMetadata.profileFacts` in the API response.
- Production `CORS_ORIGINS` should include `https://lumina-stage.com`, `https://www.lumina-stage.com`, the Vercel fallback URL, and local QA origins only.
