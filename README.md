# Omega Nannies Operating System

A secure portal for **families**, **nannies** and the **Omega Nannies team**, extending [omeganannies.com](https://omeganannies.com). It covers bookings from enquiry to completion, vetting, pricing, payments, messaging and reporting.

- **Family Portal:** discover and compare vetted nannies, request bookings, accept quotations, pay deposits, manage children's care notes, message the team and the nanny, leave reviews, and book again.
- **Nanny Portal:** today's schedule, assigned bookings with care instructions (unlocked on confirmation), check-in and completion, opt-in location sharing, weekly availability and time off, calendar feed, documents and vetting status, profile edits with a review workflow.
- **Management Portal:** operations overview, booking workspace (explainable matching, assignment, quotation builder, introductions, rescheduling, EFT recording, refunds, timeline), nanny vetting and document review, family records, versioned pricing, help content, support and review moderation, reports with CSV export, and administration (staff permissions, MFA, integrations, retention, audit log).

## Quick start (local demo)
```bash
npm install
cp .env.example .env   # set APP_SECRET (openssl rand -base64 32), DATABASE_URL
npm run db:migrate
DEMO_MODE=true npm run db:seed:demo
npm run build && npm start   # http://localhost:3000
```
Demo logins (password `OmegaDemo2026!`): `family.demo@`, `family2.demo@`, `nanny.demo@`, `manager.demo@`, `ops.demo@`, `admin.demo@example.com`. All demo data is synthetic and flagged `is_demo`. The seed refuses to run against a database containing real users.

## Tests
```bash
npm run typecheck && npm run lint
TEST_DATABASE_URL=postgres://…/omega_test npm test   # 21 unit + 8 integration (real Postgres)
npm run test:e2e                                      # 7 Playwright journeys against the running demo
```
Latest results: typecheck clean, lint clean, **29/29** unit and integration tests, **7/7** E2E (desktop + mobile).

## Documentation
[Audit](docs/AUDIT.md) · [Architecture](docs/ARCHITECTURE.md) · [Security & privacy](docs/SECURITY.md) · [Deployment & readiness matrix](docs/DEPLOYMENT.md) · [Reporting definitions](docs/REPORTING.md) · [Self-audit](docs/SELF-AUDIT.md) · [Implementation log](docs/IMPLEMENTATION_LOG.md)

## Decisions Omega needs to make
Confirm rates (the website has two conflicting price sets), deposit %, cancellation fees, public-holiday, overnight and travel fees, the refund policy, nanny compensation model, retention periods, and the payment provider account. Each is listed in [docs/AUDIT.md §6](docs/AUDIT.md).
