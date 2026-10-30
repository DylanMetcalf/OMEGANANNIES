# Omega Nannies Operating System

A secure portal for **families**, **nannies** and the **Omega Nannies team**, extending [omeganannies.com](https://omeganannies.com). It covers bookings from enquiry to completion, vetting, pricing, payments, messaging and reporting.

- **Family Portal:** a guided booking journey (needs → photo-led discovery with real availability → preview, shortlist and compare → ranked preferences → request with a live progress tracker), My Family, a dashboard that shows what needs attention, and rewards when switched on. Also: discover and compare vetted nannies, request bookings, accept quotations, pay deposits, manage children's care notes, message the team and the nanny, leave reviews, and book again.
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

## Nanny onboarding in one paragraph
Omega creates a profile, or imports it from omeganannies.com or a CSV, **before the nanny has a login**. Every field records its source and whether Omega has verified it. Staff add a contact email and send an invitation: a single-use, 7-day, revocable link that only works with that email address. The nanny claims the profile, sets a password, confirms their details, uploads ID, police clearance and first aid documents and a photo, and submits it for review. Omega records the five safeguarding checks, reviews the documents, then approves and publishes the profile. Only published profiles are visible to families.

## Tests
```bash
npm run typecheck && npm run lint
TEST_DATABASE_URL=postgres://…/omega_test npm test   # unit + integration against real Postgres
npm run test:e2e   # Playwright journeys, security and accessibility against the running demo
```
Latest results: typecheck clean, lint clean, **87/87** unit and integration tests, **32/32** Playwright tests (desktop and mobile), 0 serious/critical axe violations, `npm audit` 0. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Screenshots
Real screenshots of the demo environment are in [docs/screenshots](docs/screenshots).

## Documentation
[Project status](docs/PROJECT_STATUS.md) · [Product specification](docs/PRODUCT_SPECIFICATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Design system](docs/DESIGN_SYSTEM.md) · [Data model](docs/DATA_MODEL.md) · [Security & privacy](docs/SECURITY_AND_PRIVACY.md) · [Integrations](docs/INTEGRATIONS.md) · [Testing strategy](docs/TESTING_STRATEGY.md) · [Audit log](docs/AUDIT_LOG.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Deployment & handover](docs/DEPLOYMENT_AND_HANDOVER.md) · [Discovery](docs/DISCOVERY.md) · [Reporting definitions](docs/REPORTING.md)

**Pitch deck (final):** [deliverables/Omega_Nannies_Final_Platform_Pitch_Deck.pptx](deliverables/Omega_Nannies_Final_Platform_Pitch_Deck.pptx) (PDF alongside). The earlier version is kept for reference.

## Decisions Omega needs to make
Confirm rates (the website has two conflicting price sets), deposit %, cancellation fees, public-holiday, overnight and travel fees, the refund policy, nanny compensation model, retention periods, and the payment provider account. Each is listed in [docs/DISCOVERY.md §6](docs/DISCOVERY.md).
