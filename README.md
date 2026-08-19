# Accounts - Small Business Accounting App

A complete, production-ready accounting and invoicing web application for UK small businesses.

## Features

- **Dashboard** - Revenue summary, KPIs, recent activity, overdue alerts
- **Clients** - Full CRUD with search, archive, outstanding balance tracking
- **Quotes** - Create estimates, convert to invoices
- **Invoices** - Professional invoicing with VAT, automatic numbering, PDF generation
- **Recurring Invoices** - Template-based automated billing
- **Payments** - Full/partial payment recording with automatic status updates
- **Credit Notes** - Issue credits against invoices
- **Expenses** - Categorised expense tracking with VAT
- **Mileage** - HMRC-compliant mileage logging
- **Bank Import** - CSV upload with auto-detection and categorisation
- **Reports** - P&L, Sales by Month, Expenses by Category, Aged Debtors, VAT Summary, Client Revenue
- **Settings** - Company profile, invoice defaults, tax/VAT, email templates, audit log
- **Data Export** - CSV export for all modules

## Tech Stack

- Next.js 14 (App Router)
- React 18 + TypeScript
- Tailwind CSS
- Prisma ORM + PostgreSQL
- Zod validation
- jspdf + jspdf-autotable for PDF generation

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open http://localhost:4000

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from your `.env`. Change those values before any production use. Do not use the example placeholders in production.

If the database already exists from an old `db push` workflow, do not deploy the baseline blindly. Follow [docs/migrations.md](docs/migrations.md).

`npm run db:push` is forbidden once migrations exist. Use Prisma migrate for schema changes.

## Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| SESSION_SECRET | Random string for session signing (min 32 chars) |
| ADMIN_EMAIL | Initial admin login email (local/seed) |
| ADMIN_PASSWORD | Initial admin password (change before production) |
| EMAIL_PROVIDER | mock, resend, or smtp |

## Scripts

| Script | Description |
|--------|-------------|
| npm run dev | Development server on port 4000 |
| npm run build | Production Next.js build (does not migrate) |
| npm run build:vercel | Vercel production build; migrates only when `VERCEL_ENV=production` |
| npm run db:migrate | Create/apply migrations locally (`prisma migrate dev`) |
| npm run db:migrate:deploy | Apply pending migrations (`prisma migrate deploy`) |
| npm run db:seed | Seed default data |
| npm run db:studio | Prisma Studio |
| npm run finalise | Typecheck, test, build, and commit (no push, no DB writes) |
| npm run finalise:push | Same as finalise, then push the current branch |

## Deployment

### Vercel

1. Push to GitHub
2. Import to Vercel
3. Set environment variables (PostgreSQL `DATABASE_URL`, `SESSION_SECRET`, admin credentials)
4. Deploy. Production builds run `npm run build:vercel`, which applies migrations only when `VERCEL_ENV=production`. Preview builds do not migrate.

See [docs/migrations.md](docs/migrations.md) and [SETUP.md](SETUP.md).

## Security

- No hardcoded secrets
- HTTP-only session cookies
- bcrypt password hashing
- Input validation with Zod
- Protected routes via middleware

See SECURITY_NOTES.md for details.
