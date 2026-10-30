# Deployment & handover

## Recommended hosting
- **App:** Vercel (or any Node 22 host), deployed at e.g. `portal.omeganannies.com`. The marketing site stays on its Laravel host.
- **Database:** managed PostgreSQL 16 with the `btree_gist` extension (Supabase, Neon or RDS), daily backups and point-in-time recovery.
- **Malware scanning:** a ClamAV daemon reachable at `CLAMAV_HOST` (e.g. a small container next to the app).
- **Files:** Supabase Storage private bucket (`STORAGE_DRIVER=supabase`). Local disk storage is only for development and demo.
- **Cron:** call `GET /api/cron/daily` hourly with `Authorization: Bearer $CRON_SECRET` (it sends reminders, expires checks and quotes, flags unpaid holds after 48 h, clears location data, purges rate limits and retries emails).

## Steps
1. Create the database, then `DATABASE_URL=… npm run db:migrate`.
2. `ADMIN_EMAIL=you@omeganannies.com npm run db:bootstrap` loads services, the **draft** price book, holidays and FAQs, and prints a one-time admin invitation.
3. Set the environment variables below and deploy. Point DNS `portal` at the host; HTTPS is automatic on Vercel.
4. Sign in as admin, enable two-step verification, and invite managers and ops staff.
5. Review and **publish** the price book (Pricing → v1).
6. Nannies: run **Import from omeganannies.com** (or the CSV import), review each draft's details, add contact emails, and send invitations. Once a nanny claims their profile and uploads documents, record the 5 checks, review the documents, then approve and publish.
7. Set **Booking & privacy rules** in Administration (address reveal point, nanny acceptance) and the retention periods.
8. Clear every warning under "Before going live" in Administration.
9. Configure integrations; Administration shows the real status of each.

## Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public base URL used in emails and payment callbacks |
| `APP_SECRET` | 32+ random bytes; HMAC for document links and calendar feeds |
| `REQUIRE_STAFF_MFA` | Default `true` outside demo; keep it on |
| `CLAMAV_HOST`, `CLAMAV_PORT` | Malware scanner for uploads |
| `WEBSITE_URL` | Source for the nanny import (default https://omeganannies.com) |
| `DEMO_MODE` | `true` only in the demo environment (demo payments, captured emails, banner) |
| `CRON_SECRET` | Bearer token for `/api/cron/daily` |
| `STORAGE_DRIVER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | Private document storage |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email (verified sending domain required) |
| `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_SANDBOX` | Card/EFT payments |
| `WEBSITE_WEBHOOK_SECRET` | HMAC shared with the Laravel site for enquiry handoff |
| `CALENDLY_WEBHOOK_SIGNING_KEY`, `CALENDLY_TOKEN` | Optional Calendly webhook |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional help assistant (default `claude-opus-5-5`) |

## Website handoff (Laravel side)
After saving an enquiry, POST JSON to `https://portal…/api/enquiries` with header `X-Omega-Signature: base64url(HMAC-SHA256(rawBody, WEBSITE_WEBHOOK_SECRET))`:
`{ enquiryId, firstName, lastName, email, phone, area, startDate, endDate, children, country, nannyType, notes, consent: true }`. Responses: 201 created, 200 duplicate, 401 bad signature, 422 validation errors.

## Production readiness
| Capability | Implemented | Tested | Configured | Verified in production |
|---|---|---|---|---|
| Auth, roles, MFA, sessions | ✅ | ✅ unit, integration, E2E | ✅ | ❌ not deployed |
| Booking engine, matching, pricing, conflicts | ✅ | ✅ | ✅ (price book draft) | ❌ |
| Nanny pre-profiles, website/CSV import, claiming | ✅ | ✅ integration + E2E | ✅ | ❌ |
| Malware scanning (ClamAV) | ✅ | ❌ no scanner available | ❌ needs `CLAMAV_HOST` | ❌ |
| PWA (manifest, static-only cache) | ✅ | ⚠️ manual + E2E registration | ✅ | ❌ |
| Messaging, notifications (in-app) | ✅ | ✅ | ✅ | ❌ |
| Email delivery (Resend) | ✅ | ⚠️ dedupe/outbox tested; no live send | ❌ needs key + domain | ❌ |
| PayFast payments | ✅ | ✅ signatures/replay/amount (unit + integration); demo E2E | ❌ needs merchant account | ❌ |
| Document storage (Supabase) | ✅ | ⚠️ local driver only | ❌ | ❌ |
| Website enquiry handoff | ✅ | ⚠️ signature rejection tested | ❌ needs Laravel change + secret | ❌ |
| Calendly webhook | ✅ (log-only) | ⚠️ signature path not exercised | ❌ | ❌ |
| AI assistant | ✅ | ⚠️ FAQ search tested; no live model call | ❌ needs API key | ❌ |
| Calendar feed (ICS) | ✅ | ⚠️ manual | ✅ | ❌ |

## Recovery
Restore the database from point-in-time backup; files from bucket versioning. Rotating `APP_SECRET` invalidates outstanding document links and calendar feed URLs (nannies re-copy their feed). Suspending a user revokes their sessions immediately.

## Handover
- **Code:** branch `claude/elegant-brown-433ln0` (no pull request opened). The commit history follows the audit cycles.
- **Credentials:** none are included or invented. Omega must create the PayFast, Resend, Supabase and hosting accounts and set them as environment variables.
- **Decisions needed:** see PRODUCT_SPECIFICATION §9 and DISCOVERY §6.
- **Before real users:** clear all Administration warnings; run a PayFast sandbox payment end to end; send real test emails; run a penetration test; get a legal review of the privacy notice and retention; do a screen-reader check.
- **Status and open defects:** PROJECT_STATUS.md and KNOWN_LIMITATIONS.md.
