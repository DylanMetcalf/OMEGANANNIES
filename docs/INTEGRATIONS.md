# Integrations

Every integration reports its real status in **Administration → Integrations**. Nothing is shown as connected unless credentials are present. No credentials exist in this repository, and none were invented.

| Integration | What it does | Status | To activate |
|---|---|---|---|
| **omeganannies.com — nanny import** | Reads the public `/our-nannies` page (`data-nanny` JSON) and upserts **draft, unpublished** profiles with photos stored privately. Idempotent; never overwrites edited or verified fields. Fails safely when the site is unreachable or its layout changes | **Working** — ran against the live site: 17 profiles and 17 photos imported as drafts | Nothing. Run from Management → Nannies. `WEBSITE_URL` overrides the source |
| **omeganannies.com — enquiry handoff** | Laravel posts each enquiry to `/api/enquiries`, signed with an HMAC | Built; rejects unsigned requests | Change on the Laravel side plus `WEBSITE_WEBHOOK_SECRET` (contract in DEPLOYMENT_AND_HANDOVER) |
| **Public nanny API** | `/api/public/nannies` serves approved and published profiles for the website | Built | Website consumes it (optional) |
| **PayFast** | Checkout plus ITN: signature, merchant ID and server-to-server validation; amount must equal the server-side attempt; idempotent events; duplicate-payment detection | Built and tested with signed fixtures; **no merchant account** | `PAYFAST_MERCHANT_ID/KEY/PASSPHRASE`, `PAYFAST_SANDBOX=false` after a sandbox trial |
| **Resend (email)** | Transactional email from an outbox with dedupe and retries (up to 5×). Without a key, emails are *captured*, not sent | Built; **no API key** | `RESEND_API_KEY`, verified sending domain, `EMAIL_FROM` |
| **Supabase Storage** | Private bucket for documents and photos | Built; only the local driver was exercised | `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` |
| **ClamAV** | Scans every upload (clamd INSTREAM). Infected files are rejected and can never be approved | Built; **no scanner in this environment**, so files are marked "not scanned" | `CLAMAV_HOST` (and `CLAMAV_PORT`, default 3310) |
| **Calendly** | Webhook events are logged for review and never confirm bookings | Built (log only) | `CALENDLY_WEBHOOK_SIGNING_KEY` |
| **Calendar feed (ICS)** | Signed per-nanny feed | Built | — |
| **Help assistant** | Answers only from approved FAQ articles | FAQ search works without a key | `ANTHROPIC_API_KEY` (optional) |
| **Scheduled jobs** | `GET /api/cron/daily` (Bearer `CRON_SECRET`), hourly: reminders, expiries, unpaid-hold flags, retention, email retries, housekeeping | Built and tested | `CRON_SECRET` plus a scheduler (e.g. Vercel Cron) |

## Website import — source and status record
| Content | Source | Status |
|---|---|---|
| 17 nanny profiles (name, quote, bio, experience, languages, licence, swimmer, age groups) | omeganannies.com/our-nannies | Imported as unverified drafts; provenance `website`; not published |
| 17 nanny photos | omeganannies.com/storage/images/* | Stored privately; shown only to authorised roles |
| Hero and founders photography | omeganannies.com home/about | Used on the landing and sign-in pages (`public/brand/`) |
| Logo, palette anchors, tone of voice, services, areas, FAQ (20), vetting checklist, enquiry fields | Public pages | Reused (see DISCOVERY.md) |
| Rates | /rates vs service pages (conflicting) | Draft price book; **needs Omega's confirmation** |

No private pages were accessed and no authentication was bypassed. Website claims (for example "police-clearance verified") are **not** turned into verification records.

## Final refinement phase
| Integration | What it does | Status | To activate |
|---|---|---|---|
| Google Calendar | Two-way: bookings out (one event per care day), busy times in, webhooks (`events.watch`), incremental sync tokens | Built; tested with a fake provider | Google Cloud OAuth client (scopes `openid email calendar.events`), redirect `$APP_URL/api/calendar/oauth/google`, `GOOGLE_CLIENT_ID/SECRET`, `CALENDAR_TOKEN_KEY` |
| Outlook / Microsoft 365 | Same via Microsoft Graph (`Calendars.ReadWrite`, delta queries, subscriptions renewed every ~2.5 days) | Built; tested with a fake provider | Azure app registration, redirect `$APP_URL/api/calendar/oauth/microsoft`, `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` |
| Twilio SMS | Short booking texts with signed status callbacks | Built; signature verification unit-tested | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` or `TWILIO_MESSAGING_SERVICE_SID` |
| Twilio WhatsApp | Same channel model | Built | WhatsApp-enabled sender (`TWILIO_WHATSAPP_FROM`) **and Meta-approved templates** for business-initiated messages |
| Resend delivery webhooks | Marks emails delivered or bounced | Built; Svix verification unit-tested | `RESEND_WEBHOOK_SECRET`, webhook URL `$APP_URL/api/notifications/resend` |
| Website entry links | `/start?intent=book|find|login|nanny-login|account&service=<website slug>` and `/r/<CODE>` | Built | Point the website's buttons at these URLs |

Calendar and messaging providers were **not** contacted from this environment, and no credentials were created or assumed.
