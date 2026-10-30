# Security, privacy & safeguarding

## Authentication
- scrypt password hashing (N=2^15). Login timing is equalised for unknown accounts. Registration and password reset return the same response whether or not the account exists.
- Sessions are random 256-bit tokens, stored only as SHA-256 hashes, in httpOnly + SameSite=Lax (+Secure in production) cookies. Management sessions last 12 hours, others 7 days. Password reset and suspension revoke all sessions.
- Email verification (24h), single-use reset (1h) and invitations (7d) are hashed, single-use tokens.
- TOTP two-step verification (RFC 6238) is **mandatory for staff** (`REQUIRE_STAFF_MFA`, on by default outside demo). Staff are sent to `/mfa-setup` before any management page or action.
- Email change requires re-entering the password, then confirming the new address by email. The old address is notified. Password change signs out all other sessions. Confirmation links require a POST, so email scanners prefetching a link can't consume it.
- **Nanny claim invitations:**
  - 256-bit tokens, stored as SHA-256; valid 7 days; single use; revocable.
  - One open invitation per nanny. A new invitation, or a change of contact email, replaces or revokes the old one.
  - The claim must use the invited email.
  - Every failure returns the same generic message.
  - After 5 failed attempts the token is revoked.
  - Rate limited per IP and per token.
  - Claiming locks the invitation and nanny rows, so two simultaneous claims produce exactly one account.
  - At most 5 invitations per nanny per hour.
- Postgres-backed rate limits on login (per IP and per email), registration, reset, MFA, messages, uploads, location updates, the assistant and the website webhook.

## Authorisation
- Roles: family, nanny, ops, manager, admin. Granular permissions (17) are listed in `lib/permissions.ts`. Ops staff get only what is granted. Granted permissions are ignored for non-management roles.
- Every page calls `requireUser`, and every action or route calls `assertUser` or a policy function. Middleware adds a 307 for requests without a session cookie, but is not relied on.
- `bookingAccess()` is the single policy for booking data. Families see only their own households. Nannies see only assigned bookings, and children's medical details and precise addresses only once the booking is confirmed or in progress. Management access needs `bookings.view`; medical details need `sensitive.view`.
- Tested in `tests/integration` and E2E: cross-family access, unassigned nanny access, role escalation (family calling management services, ops without a grant), invalid transitions, forged and replayed payment notifications, an unsigned website webhook, and anonymous report export.

## Data protection (POPIA by design)
- Data minimisation on children's profiles. Consents (privacy, child data, booking terms, quotation acceptance, location, marketing) are recorded with versions.
- **Residential addresses and care notes** are visible to a nanny only from the configured reveal point (on confirmation by default, or on the first care day) and only for bookings they have accepted. While an offer is pending, the nanny sees the area only. Declined offers disappear from the nanny's view.
- **Nanny photos and website-imported data** are private until the profile is approved and published (`/api/photos/[id]` checks access).
- **Uploads:** type detected from magic bytes, 10 MB limit (5 MB for images), safe file names, optional ClamAV scan. Infected files are rejected and can never be approved; unscanned files are labelled.
- **Your own data:** a JSON export (`/api/account/export`) scoped to the signed-in user, with storage keys and internal notes removed. Account closure; privacy requests.
- Documents use private storage (local `0600` files or a private Supabase bucket). Content type is detected from magic bytes; maximum 10 MB. Downloads need a 5-minute HMAC-signed link bound to the user **and** a fresh authorisation check; every view is audited.
- Location sharing is opt-in, time-limited (30 min–4 h), only on booking dates, keeps only the latest point, clears on stop or expiry, and offers a manual check-in alternative. There is no background tracking.
- The public nanny API exposes approved profiles only, never checks, documents or internal notes. The CSV export excludes children's data and contact details and neutralises formula injection.
- The assistant receives approved articles only — no account data — and cannot quote, promise refunds or make safeguarding decisions.
- Privacy requests (export, correction, closure) are logged as support cases. Retention settings live in Administration.
- Security headers: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (geolocation self only).

## Logging
Errors are logged as name, code and a truncated message with email addresses masked. Passwords, tokens, document contents and payment credentials are never logged. Audit metadata records identifiers, not document contents.

## Production guard
At server start, `src/instrumentation.ts` refuses to boot in any of these cases:
- `APP_SECRET` is missing or weak;
- a live (non-demo) deployment has a non-https `APP_URL`;
- demo mode is combined with live PayFast credentials.

Administration lists the remaining pre-launch warnings: email, storage, scanner, cron, MFA, sandbox.

## Payments
No card data is stored or processed by the portal. A payment is applied only when the PayFast signature verifies with our passphrase, the merchant ID matches, PayFast's `/eng/query/validate` confirms the notification, and the amount equals the server-side attempt. Event IDs are unique, so replays are no-ops, and terminal states never regress. Browser return pages read status from the database only. A repeated "Pay" click reuses the open attempt. If two attempts both succeed at the provider, the invoice is never double-counted: the second is flagged `duplicate_payment_refund_needed` with a high-priority refund task.

## Verification
See AUDIT_LOG.md (Audits 2, 4 and 5) for each attack attempted and the test that guards it.

## Open items
- Configure ClamAV (or an equivalent) before accepting real documents.
- CSP still allows `'unsafe-inline'` scripts (needed by Next's inline bootstrap without nonces). Move to nonce-based CSP.
- Add error monitoring (e.g. Sentry) and run `npm audit` in CI.
- Get a legal review of the privacy notice, retention periods and message-oversight policy.
- Do a penetration test before go-live.
