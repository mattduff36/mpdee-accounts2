# Agent guide (mpdee-accounts2)

This is a UK small-business **accounts** app: Next.js 14, Prisma, PostgreSQL. Money is stored as **integer pence**.

## Do not confuse with other repos

- There is **no** avsworklog finalise pipeline here. Do not run avsworklog `scripts/finalise.ts`, `finalise:repair`, or `workflow-protocol.ts`.
- `/finalise` → `npm run finalise`. `/fap` → `npm run finalise:push`. Neither applies database migrations.
- `deploy-to-vercel` is not `/fap`. Higgsfield website/deploy/TikTok tools must not be used in this repo.
- Cursor Origin/share is not supported on native Windows; do not use it here.

## Schema and deploy

- Schema changes go through Prisma migrations. `db push` is forbidden once migrations exist.
- `npm run build` does **not** migrate. Production Vercel uses `npm run build:vercel`, which migrates only when `VERCEL_ENV=production`.
- See [docs/migrations.md](docs/migrations.md). Never print `DATABASE_URL`.

## Email

Transactional email lives in `src/emails/` as TypeScript HTML. Do not add MJML or the `mjml` package unless the user explicitly asks.

This repo does not collect workflow-completion markers.
