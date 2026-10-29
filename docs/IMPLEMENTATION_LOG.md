# Implementation log
- **Audit:** empty repo; Laravel public site analysed (brand, rates, FAQ, vetting, enquiry form) → docs/AUDIT.md.
- **Foundation:** Next 15 + Drizzle + Postgres 16; 45-table schema; exclusion constraint migration; scrypt sessions, tokens, TOTP; RBAC with 17 permissions; design tokens and components.
- **Core data:** families, members, locations, children with consent; nannies, qualifications, checks, documents, change requests; availability rules and exceptions; services; versioned price books; SA public holidays.
- **Booking engine:** idempotent requests, state machine, holds, explainable matching with override audit, server-priced quotations, acceptance → invoices, reschedule, cancellation, completion, reviews, repeat booking.
- **Comms and money:** messaging with oversight audit and reporting; notification outbox with dedupe and Resend; PayFast checkout + ITN verification; demo provider; receipts; manual EFT; refunds; meetings; ICS feed.
- **Operations:** overview queues, reports + CSV, help centre + grounded assistant, location sharing, admin (staff, permissions, integrations, MFA, retention, audit log), website enquiry API, public nanny API, Calendly webhook, cron.
- **Hardening:** unit, integration and E2E tests; fixed enum-array bug and action-redirect hang; visual review and fixes; middleware 307; security headers.
