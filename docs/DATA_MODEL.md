# Data model

PostgreSQL 16 with 47 tables, defined in `src/db/schema.ts` (Drizzle). Versioned SQL migrations live in `drizzle/` (`0000`–`0003`). Money is stored as integer minor units plus a currency. Time is stored as `timestamptz` (UTC); care sessions are stored as `tstzrange`.

## Identity & access
| Table | Purpose / key rules |
|---|---|
| `users` | Account, status (`invited/active/suspended/closed`), scrypt hash, TOTP secret, `is_demo` |
| `user_roles` | family · nanny · ops · manager · admin |
| `sessions` | SHA-256 of the session token only. Expiry; MFA-passed flag; last seen |
| `auth_tokens` | Hashed single-use tokens: verify_email, reset_password, invite, change_email |
| `nanny_invitations` | Claim tokens (SHA-256), bound to the nanny **and** an email. Has `expires_at`, `revoked_at`, `used_at`, `failed_attempts`. A partial unique index allows **one open invitation per nanny** |
| `rate_limits` | Fixed-window counters per key (IP, email, token). Purged daily |
| `consents` | Versioned consent records (privacy, child data, terms, location, marketing) |
| `audit_events` | Actor, action, entity, metadata. Append-only by convention |

## Families
`families`, `family_members` (`is_primary`, `can_book`, `can_pay`), `service_locations` (private address), `children` (minimised care data), `favourites`.

## Nannies
| Table | Notes |
|---|---|
| `nannies` | Public profile fields plus private `contact_email` and `contact_phone`. Also `user_id` (null until claimed); `status` (`draft/onboarding/pending_approval/approved/suspended/archived`); `published`; `photo_key` (private storage); provenance (`import_source`, `source_ref`, `source_url`, `imported_at`, unique `(import_source, source_ref)`); `provenance` JSON per field `{source: website/csv/admin/nanny, verified, confirmedByNanny, at, by}` |
| `qualifications`, `verification_checks` | 5 safeguarding checks with expiry. A passed check requires a completion date |
| `documents` | Private storage key, sniffed MIME type, `status` (`pending_review/approved/rejected/expired`), `scan_status` (`clean/infected/not_scanned`). Owned by a nanny **or** a family |
| `profile_change_requests` | Nanny edits that need review (including photo changes after onboarding) |
| `availability_rules`, `availability_exceptions` | Weekly pattern, time off |

## Booking engine
| Table | Notes |
|---|---|
| `service_categories`, `price_books`, `price_items`, `public_holidays` | Versioned, effective-dated pricing |
| `bookings` | State machine status; `weekdays smallint[]` for recurring patterns; `nanny_response` (`pending/accepted/declined`); idempotency key |
| `booking_sessions` | One `tstzrange` per care day. `EXCLUDE USING gist (nanny_id WITH =, period WITH &&) WHERE (blocking)` makes double-booking impossible |
| `booking_children`, `booking_events`, `match_results` | Timeline (internal notes flagged), explainable match snapshot |
| `quotations` | Snapshotted line items and totals, validity, acceptance |
| `invoices`, `payments`, `payment_events`, `refunds` | `payment_events (provider, event_id)` is unique, so replays have no effect. Invoices are locked when a payment is applied |

## Communication & operations
`conversations`, `conversation_participants`, `messages`, `meetings`, `location_shares` (latest point only, cleared on expiry), `reviews`, `notifications` (dedupe key; also the email outbox with retries), `notification_preferences`, `faq_articles`, `support_requests` (includes privacy requests), `tasks`, `settings` (typed: `addressReveal`, `requireNannyAcceptance`, retention), `integration_configs` (status only, never secrets).

## Ownership boundaries
The platform owns operational records. The public website owns marketing copy. Website nanny data is imported once as **unverified drafts**: the website is a source of claims, never of verification.
