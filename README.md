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
- Prisma ORM + SQLite (dev) / PostgreSQL (prod)
- Zod validation
- jspdf + jspdf-autotable for PDF generation

## Quick Start

```bash
npm install
cp .env.example .env
npx prisma db push
npm run db:seed
npm run dev
```

Default login: admin@example.com / changeme123

## Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | SQLite file or PostgreSQL connection string |
| SESSION_SECRET | Random string for session signing (min 32 chars) |
| EMAIL_PROVIDER | mock, resend, or smtp |

## Scripts

| Script | Description |
|--------|-------------|
| npm run dev | Development server |
| npm run build | Production build |
| npm run db:push | Push schema to database |
| npm run db:seed | Seed default data |
| npm run db:studio | Prisma Studio |

## Deployment

### Vercel
1. Push to GitHub
2. Import to Vercel
3. Set environment variables
4. Deploy

## Security

- No hardcoded secrets
- HTTP-only session cookies
- bcrypt password hashing
- Input validation with Zod
- Protected routes via middleware

See SECURITY_NOTES.md for details.
