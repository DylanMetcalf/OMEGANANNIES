# Architecture

**Modular monolith**: Next.js 15 (App Router, React 19, TypeScript, Server Components and Server Actions), Tailwind CSS v4, PostgreSQL 16 via Drizzle ORM. One app, one database, three role-specific portals plus a public help centre.

```
src/
  app/(auth)/        sign-in, register, verify, reset, invite, MFA     ── actions.ts
  app/family/        Family Portal                                    ── actions.ts
  app/nanny/         Nanny Portal                                     ── actions.ts
  app/manage/        Management Portal                                ── actions.ts
  app/messages/      shared messaging (role-aware shell)
  app/help/          help centre + grounded assistant
  app/pay/           payment hand-off / return / demo provider
  app/api/           webhooks (PayFast, website, Calendly), documents, receipts, calendar feed, reports CSV, cron, health, public nannies
  lib/               domain modules (single source of truth per concern)
    auth.ts permissions.ts tokens.ts crypto.ts rate-limit.ts audit.ts      identity & access
    bookings.ts booking-state.ts matching.ts pricing.ts time.ts            booking engine
    payments/{service,payfast}.ts money.ts                                 payments
    messaging.ts notify.ts storage.ts nannies.ts reports.ts assistant.ts
  db/schema.ts       45 tables; drizzle/ versioned SQL migrations
```

**Module boundaries.** Pages and actions never change booking status directly. They call `lib/bookings.ts`, where `transitionTx` is the only status writer: it validates against the state machine, places or releases the nanny's time hold, and writes history and audit in one transaction. Payments only confirm bookings through `applyPaymentEvent`.

**Booking lifecycle.** `enquiry → matching → (introduction) → quotation → awaiting_approval → awaiting_payment → confirmed → in_progress → completed`, plus `declined`, `cancelled`, `refund_pending`, `refunded` and `disputed`. Rescheduling is an audited event on an active booking, not a separate state. Who may perform each transition (family, nanny, management or system) is encoded in `booking-state.ts` and unit-tested.

**Concurrency and double-booking.** `booking_sessions` stores one UTC `tstzrange` per care day. A Postgres `EXCLUDE USING gist (nanny_id WITH =, period WITH &&) WHERE (blocking)` constraint makes overlapping holds impossible, even under concurrent requests. Sessions become blocking when a family accepts a quotation (`awaiting_payment`), so the first family to accept holds the nanny. Bookings are locked with `SELECT … FOR UPDATE`. Requests carry an idempotency key.

**Money.** Integer cents with explicit currency; basis-point modifiers use BigInt half-up rounding. Prices come from versioned, effective-dated price books. Each quotation snapshots its line items, so publishing new prices never alters an accepted quotation.

**Data ownership.** The portal owns families, children, nannies, vetting, bookings, money and messages. The website owns marketing copy. Enquiries flow site → portal; approved profiles flow portal → site.
