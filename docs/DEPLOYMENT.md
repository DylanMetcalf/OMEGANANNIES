# Deployment & production checklist

## Recommended hosting
- **App:** Vercel (or any Node 22 host), deployed at e.g. `portal.omeganannies.com`. The marketing site stays on its Laravel host.
- **Database:** managed PostgreSQL 16 with the `btree_gist` extension (Supabase, Neon or RDS), daily backups and point-in-time recovery.
- **Files:** Supabase Storage private bucket (`STORAGE_DRIVER=supabase`). Local disk storage is only for development and demo.
- **Cron:** call `GET /api/cron/daily` hourly with `Authorization: Bearer $CRON_SECRET` (it sends reminders, expires checks and quotes, clears location data, and retries emails).

## Steps
1. Create the database, then `DATABASE_URL=… npm run db:migrate`.
2. `ADMIN_EMAIL=you@omeganannies.com npm run db:bootstrap` loads services, the **draft** price book, holidays and FAQs, and prints a one-time admin invitation.
3. Set the environment variables below and deploy. Point DNS `portal` at the host; HTTPS is automatic on Vercel.
4. Sign in as admin, enable two-step verification, and invite managers and ops staff.
5. Review and **publish** the price book (Pricing → v1).
6. Invite nannies, record vetting checks and approve them.
7. Configure integrations; Administration shows the real status of each.

## Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public base URL used in emails and payment callbacks |
| `APP_SECRET` | 32+ random bytes; HMAC for document links and calendar feeds |
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
