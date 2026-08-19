# Security Notes

## Architecture
- Sessions stored in HTTP-only, SameSite=lax, secure cookies
- bcrypt password hashing (cost factor 12)
- Role-based access control
- All routes protected by middleware
- Input validated with Zod
- Prisma ORM prevents SQL injection

## Environment
- .env is gitignored
- .env.example contains only placeholders
- No API keys or credentials in repository

## Deployment Checklist
- [ ] Change default admin password
- [ ] Generate strong SESSION_SECRET
- [ ] PostgreSQL `DATABASE_URL` (SQLite is not used)
- [ ] Enable HTTPS
- [ ] Set NODE_ENV=production
