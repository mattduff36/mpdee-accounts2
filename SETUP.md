# Setup Guide

## Prerequisites

- Node.js 18+ (recommended: 20 LTS)
- npm 9+
- PostgreSQL (local or hosted)

## Installation

1. Extract the project archive
2. Run `npm install`
3. Copy `.env.example` to `.env` and set a PostgreSQL `DATABASE_URL`
4. Apply schema: `npm run db:migrate:deploy` (empty database) or follow [docs/migrations.md](docs/migrations.md) if the database already exists
5. Run `npm run db:seed`
6. Run `npm run dev`
7. Open http://localhost:4000

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. Change both before production. Do not ship the example placeholders.

`npm run db:push` is forbidden once migrations exist.

## Production Checklist

- [ ] Change admin email/password (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- [ ] Set strong `SESSION_SECRET` (min 32 chars)
- [ ] PostgreSQL `DATABASE_URL` (direct connection for `prisma migrate deploy` if the pooled URL cannot run DDL)
- [ ] Enable HTTPS
- [ ] Set `NODE_ENV=production`
- [ ] Configure email provider
- [ ] Confirm git `origin` and the branch you will push before the first `/fap`
- [ ] If this database was created with `db push`, snapshot it, run `npm run db:drift-check -- --allow-remote-db`, then `npx prisma migrate resolve --applied 20260819160000_init` only if drift-check is clean

## Vercel and MCP

Git push to the linked GitHub remote is the default deploy path. Vercel MCP is optional: authenticate it only when you want dashboard or inspect tools from chat. Do not treat MCP auth as required for `/fap`.

`/fap` is this repo’s `npm run finalise:push`. It is not `deploy-to-vercel`, Higgsfield `deploy_website`, or avsworklog finalise. Preview deployments must not share the production database if you later enable preview migrations.

## Finalise

- `npm run finalise` — typecheck, test, build, commit. No push. No database writes.
- `npm run finalise:push` or `/fap` — same, then push the current branch.
- Before the first real `/fap`, state the branch and confirm `origin` points at the intended remote.
- If `.env` points at a remote database, finalise refuses unless you pass `--allow-remote-db`.
