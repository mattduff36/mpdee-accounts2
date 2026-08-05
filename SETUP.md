# Setup Guide

## Prerequisites

- Node.js 18+ (recommended: 20 LTS)
- npm 9+

## Installation

1. Extract the project archive
2. Run `npm install`
3. Copy `.env.example` to `.env`
4. Run `npx prisma db push`
5. Run `npm run db:seed`
6. Run `npm run dev`
7. Open http://localhost:3000

Default login: admin@example.com / changeme123

## Production Checklist

- [ ] Change default admin password
- [ ] Set strong SESSION_SECRET (min 32 chars)
- [ ] Use PostgreSQL instead of SQLite
- [ ] Enable HTTPS
- [ ] Set NODE_ENV=production
- [ ] Configure email provider
