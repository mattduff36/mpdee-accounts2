# Small Business Accounts App Rebuild Plan

## Objective
Rebuild a production-ready small business accounting/invoicing web app from scratch, based on the reference repo but significantly improved with modern best practices, UK-specific features, and clean architecture.

## Stage 1 - Design & Architecture
- Design the app structure, database schema, API boundaries
- Choose final stack and security model
- Output: architecture.md, database schema, API contract

## Stage 2 - Database & Backend Foundation
- Prisma schema with all models
- Migrations setup
- Authentication system (secure sessions)
- Server actions foundation
- Output: prisma schema, auth system, base server actions

## Stage 3 - Core Feature Development (Frontend + Backend)
- Dashboard page
- Clients CRUD + detail page
- Invoices CRUD + PDF generation
- Expenses CRUD
- Bank statement CSV import
- Payments recording
- Reports module
- Settings module

## Stage 4 - Advanced Accounting Features
- VAT-aware calculations
- Credit notes
- Recurring invoices
- Quotes/estimates
- Aged debtors report
- VAT summary report
- Self-assessment placeholders
- Audit logging
- Client statements
- Email sending with templates

## Stage 5 - UI/UX Polish & QA
- Responsive design verification
- Form validation
- Error states
- Loading states
- Accessibility
- Build checks
- Secret scan
- Test suite

## Stage 6 - Documentation & Delivery
- README.md
- SETUP.md
- .env.example
- CHANGELOG.md
- SECURITY_NOTES.md
- TEST_REPORT.md
- Final zip/package

## Skills Used
- vibecoding-webapp-swarm: For React/Next.js app building
- Progressive loading as needed

## Agent Swarm Structure
1. **Architect_Agent**: Designs schema, API, and app structure
2. **Database_Agent**: Implements Prisma schema and migrations
3. **Auth_Backend_Agent**: Authentication and core server actions
4. **Frontend_Core_Agent**: Dashboard, layout, navigation, core pages
5. **Invoices_Agent**: Invoice CRUD, PDF, email, payments
6. **Clients_Agent**: Client management, detail pages, search
7. **Expenses_Bank_Agent**: Expenses, categories, bank import
8. **Reports_Agent**: Reports module with charts and exports
9. **Settings_Agent**: Settings, company profile, templates
10. **QA_Security_Agent**: Tests, build verification, secret scan

## Notes
- All money stored in pence as integers
- UK VAT-aware
- No hardcoded secrets
- Clean .env.example with placeholders
- Mobile responsive
- Production-ready for Vercel
