# Security, privacy & safeguarding

## Authentication
- scrypt password hashing (N=2^15). Login timing is equalised for unknown accounts. Registration and password reset return the same response whether or not the account exists.
- Sessions are random 256-bit tokens, stored only as SHA-256 hashes, in httpOnly + SameSite=Lax (+Secure in production) cookies. Management sessions last 12 hours, others 7 days. Password reset and suspension revoke all sessions.
- Email verification (24h), single-use reset (1h) and invitations (7d) are hashed, single-use tokens.
- TOTP two-step verification (RFC 6238) for management. When enabled, it is enforced on every page and action.
- Postgres-backed rate limits on login (per IP and per email), registration, reset, MFA, messages, uploads, location updates, the assistant and the website webhook.

## Authorisation
- Roles: family, nanny, ops, manager, admin. Granular permissions (17) are listed in `lib/permissions.ts`. Ops staff get only what is granted. Granted permissions are ignored for non-management roles.
- Every page calls `requireUser`, and every action or route calls `assertUser` or a policy function. Middleware adds a 307 for requests without a session cookie, but is not relied on.
- `bookingAccess()` is the single policy for booking data. Families see only their own households. Nannies see only assigned bookings, and children's medical details and precise addresses only once the booking is confirmed or in progress. Management access needs `bookings.view`; medical details need `sensitive.view`.
- Tested in `tests/integration` and E2E: cross-family access, unassigned nanny access, role escalation (family calling management services, ops without a grant), invalid transitions, forged and replayed payment notifications, an unsigned website webhook, and anonymous report export.

## Data protection (POPIA by design)
- Data minimisation on children's profiles. Consents (privacy, child data, booking terms, quotation acceptance, location, marketing) are recorded with versions.
- Documents use private storage (local `0600` files or a private Supabase bucket). Content type is detected from magic bytes; maximum 10 MB. Downloads need a 5-minute HMAC-signed link bound to the user **and** a fresh authorisation check; every view is audited.
- Location sharing is opt-in, time-limited (30 min–4 h), only on booking dates, keeps only the latest point, clears on stop or expiry, and offers a manual check-in alternative. There is no background tracking.
- The public nanny API exposes approved profiles only, never checks, documents or internal notes. The CSV export excludes children's data and contact details and neutralises formula injection.
- The assistant receives approved articles only — no account data — and cannot quote, promise refunds or make safeguarding decisions.
- Privacy requests (export, correction, closure) are logged as support cases. Retention settings live in Administration.
- Security headers: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (geolocation self only).

## Payments
No card data is stored or processed by the portal. A payment is applied only when the PayFast signature verifies with our passphrase, the merchant ID matches, PayFast's `/eng/query/validate` confirms the notification, and the amount equals the server-side attempt. Event IDs are unique, so replays are no-ops, and terminal states never regress. Browser return pages read status from the database only.

## Open items
- Run `npm audit` and a dependency scan in CI. Add error monitoring (e.g. Sentry) and log redaction review.
- Get a legal review of the privacy notice, retention periods and message-oversight policy.
- Do a penetration test before go-live.
