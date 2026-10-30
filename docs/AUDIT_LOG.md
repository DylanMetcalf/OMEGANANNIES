# Audit log

Five progressive audit-and-improvement cycles. Each finding records evidence, root cause, remediation and the test that now guards it. Severity: Critical · High · Medium · Low · Info.

| Cycle | Focus | Findings | Fixed | Open |
|---|---|---|---|---|
| 1 | Baseline functionality & integrity | 14 | 14 | 0 |
| 2 | Security, privacy & data integrity | 12 | 11 | 1 (documented) |
| 3 | Design, UI/UX & accessibility | 9 | 9 | 0 |
| 4 | End-to-end operations & edge cases | 9 | 8 | 1 (documented) |
| 5 | Independent production-readiness review | 9 | 6 | 3 (documented, need external services) |

## 1. Audit 1 — Baseline functionality and implementation integrity

**Method:** build, lint and type-check; unit and integration suites; a scripted crawl of every navigation destination and key detail page for all four roles (family, nanny, admin, anonymous), recording HTTP status and browser console errors; full browser journeys.
**Evidence:** crawl of 51 routes → all 200 with no console errors after A1-08. E2E 13/13 at the end of the cycle.

| ID | Sev | Module | Evidence / reproduction | Root cause | Remediation | Test | Result |
|---|---|---|---|---|---|---|---|
| A1-01 | High | Shell (mobile) | Mobile screenshot: bottom tab bar rendered over the header at the top of the screen | `position:fixed` tab bar inside a header with `backdrop-filter`, which becomes the containing block | Tab bar moved outside the header (`BottomTabs`) | E2E `@mobile` (navigation + no horizontal overflow) | Fixed |
| A1-02 | High | All forms | Wrong email on the claim form → the name, password and consent fields were wiped | React 19 resets uncontrolled forms after every action submission | `ActionForm` submits through a transition (input kept on error); progressive-enhancement `action` kept for no-JS | E2E claim retry after wrong email | Fixed |
| A1-03 | High | PWA | Registration form emptied itself seconds after load on a first visit | `controllerchange` also fires on first service-worker install (`clients.claim()`); the page reloaded | Reload only when a previous controller existed (genuine update) | E2E registration | Fixed |
| A1-04 | Medium | All forms | “Submitted”/“Nanny assigned” feedback never appeared when the button disappeared after success | Success message rendered inside a form that unmounts in the same commit | Global toasts fired from the action wrapper; link-bearing messages also stay inline | E2E onboarding submit | Fixed |
| A1-05 | Medium | Auth | Opening a verification link consumed the token on GET | Token consumed during page render; email scanners prefetch links | Verification and email-change confirmation require a POST button | E2E registration | Fixed |
| A1-06 | Medium | Auth | Staff/family invitation acceptance had no rate limit | Missing limiter | 10 attempts / 15 min per IP; nanny claims limited per IP and per token | Integration (claim attempts) | Fixed |
| A1-07 | Medium | Account | Changing a password left other sessions signed in | No session revocation | Other sessions deleted; notification sent | Manual + code review | Fixed |
| A1-08 | Low | PWA | `/favicon.ico` 404 console error on every page | Only an SVG favicon existed | Generated `favicon.ico` | Route crawl | Fixed |
| A1-09 | High (gap) | Onboarding | Nanny profiles could not exist without an email; invitations not revocable or visible | Original design invited at creation | Pre-created profiles, provenance, `nanny_invitations`, revoke/resend, stages | Integration + E2E | Fixed |
| A1-10 | Medium (gap) | Booking | Nannies could not accept/decline offers; address reveal hard-coded | Not implemented | `nanny_response`, offer UI, `addressReveal` and `requireNannyAcceptance` settings | Integration + E2E | Fixed |
| A1-11 | Low | Navigation | “Today” highlighted on every nanny page after adding “Get started” | Root detection by index | Portal roots matched exactly by path depth | Visual | Fixed |
| A1-12 | Medium | Tests | 3 integration tests failed after the acceptance rule | Tests skipped a now-required step | Helper performs the nanny acceptance | `npm test` | Fixed |
| A1-13 | Low | Tests | E2E failed on repeated runs | Fixed booking date collided with earlier runs’ bookings | Unique date per run; exact button match | E2E reruns | Fixed |
| A1-14 | Medium (gap) | Platform | No email change, data export, internal tasks, family documents, weekday patterns, pagination or PWA | Not implemented | All implemented (see PRODUCT_SPECIFICATION) | Unit/integration/E2E | Fixed |

## 2. Audit 2 — Security, privacy and data integrity

**Method:** threat-driven negative tests at service level (real Postgres) and HTTP level (browser), dependency audit, secret scan, review of logging, headers, uploads and auth flows.
**Evidence:** `tests/integration/security.test.ts` (11 tests), `tests/e2e/security.spec.ts` (6 tests); `npm audit --omit=dev` → 0 vulnerabilities; no secrets tracked by git.

| ID | Sev | Module | Attack / evidence | Root cause | Remediation | Test | Result |
|---|---|---|---|---|---|---|---|
| A2-01 | High | Dependencies | `npm audit`: PostCSS < 8.5.23 (source-map file disclosure, XSS in stringify), via Next | Next pins an old PostCSS | `overrides.postcss ^8.5.23` | `npm audit` → 0 | Fixed |
| A2-02 | Medium | Logging | Action errors logged whole error objects; pg errors include submitted values (e.g. duplicate email) | Raw `console.error(e)` | Log name/code/truncated message with emails masked | Code review | Fixed |
| A2-03 | High | Staff accounts | Staff could use the management portal (children’s data) with password only | MFA optional | `REQUIRE_STAFF_MFA` (default on outside demo) forces enrolment via `/mfa-setup` before any management page or action | Manual | Fixed |
| A2-04 | — | Invitations | Claim with the token but a different email | — | Generic error; failed-attempt counter; token revoked after 5 | Integration | Verified |
| A2-05 | — | Invitations | Two simultaneous claims with a valid token | — | Row lock + `user_id IS NULL` guard: exactly one succeeds | Integration (parallel) | Verified |
| A2-06 | — | Invitations | Reuse of expired, revoked, replaced or already-used tokens | — | All rejected with the same generic message; tokens stored as SHA-256 only | Integration + E2E | Verified |
| A2-07 | — | Booking data | Family B reads/acts on family A’s booking, child, quotation | — | `bookingAccess` + ownership checks in services | Integration + E2E (404) | Verified |
| A2-08 | — | Address privacy | Unrelated nanny; offered nanny before reveal point; stricter reveal setting | — | Address/care notes only from the configured status; declined offers disappear | Integration | Verified |
| A2-09 | — | Concurrency | Two families accept overlapping quotes for one nanny at once | — | Postgres exclusion constraint → one hold, other `ConflictError` | Integration (parallel) | Verified |
| A2-10 | — | Documents | Signed link replayed by another user, forged signature, anonymous | — | Signature bound to user + fresh permission check → 403/401 | E2E | Verified |
| A2-11 | — | Privacy | Data export leaking other users’ data or secrets | — | Export scoped to own records; storage keys and internal notes removed | E2E | Verified |
| A2-12 | Medium | Uploads | No malware scanning available in this environment | No ClamAV service | `scanBuffer` hook (clamd INSTREAM via `CLAMAV_HOST`); files marked “Not virus-scanned” in the UI; infected files rejected and cannot be approved | Code review | **Open — needs ClamAV in production** |

Previously verified and re-run: forged/replayed PayFast notices, amount tampering, client-supplied status changes, role escalation (integration + E2E).

## 3. Audit 3 — Design, UI, UX and accessibility

**Method:** axe-core (WCAG 2.0/2.1/2.2 A+AA tags) on 33 pages across all roles at desktop and Pixel 7 sizes; keyboard-only journey; screenshot review at 1440, 820 and 390 px; review of typography, hierarchy, density and feedback patterns.
**Evidence:** `tests/e2e/a11y.spec.ts` → 9/9 passing with zero serious/critical violations; screenshots in `docs/screenshots/`.

| ID | Sev | Module | Evidence | Root cause | Remediation | Test | Result |
|---|---|---|---|---|---|---|---|
| A3-01 | Serious (WCAG 1.4.3) | Design tokens | axe: 3.2:1 contrast on portal label, filter counts, day-off labels (36 pages) | `subtle` grey used for small text | Text uses `muted` (≥4.5:1); `subtle` reserved for icons/placeholders; token documented | a11y spec | Fixed |
| A3-02 | Serious (WCAG 2.1.1) | Tables | axe `scrollable-region-focusable` on phones | Horizontally scrolling table wrappers not focusable | All table scroll regions `tabIndex=0`, `role=region`, labelled | a11y spec (mobile) | Fixed |
| A3-03 | Medium | Management › Nannies | Screenshot 1440 px: side panels clipped, “Next step” one word per line | `1fr` grid track grew to the table’s min-content; 6 columns | `minmax(0,1fr)`; stage + next step merged; source moved under name | Visual | Fixed |
| A3-04 | Medium | Typography | Old serif display face read as decorative; “1” looked like “I” | Website typography reused in a data-dense app | Manrope (display) + Inter (UI), self-hosted via next/font, lining tabular numerals, documented scale | Visual | Fixed |
| A3-05 | Medium | Navigation (mobile) | Desktop sidebar squeezed into a drawer only | No phone-first navigation | Bottom tab bar (4 primary + More), native `<dialog>` drawer with focus handling | E2E `@mobile` | Fixed |
| A3-06 | Low | Nanny record | “Approve” offered on unclaimed drafts (always failed) | Button ignored onboarding state | Shown only once the profile is claimed and in onboarding/review | E2E approval | Fixed |
| A3-07 | Low | Feedback | No loading indication on navigation after removing the root loading boundary (Cycle 0) | — | Per-link pending indicator (`useLinkStatus`), form `aria-busy`, pending button labels | Visual | Fixed |
| A3-08 | Low | Status | Colour-only status in places | — | Badges carry a dot + text; notices have role/status semantics | a11y spec | Fixed |
| A3-09 | Info | Motion | Entrance fade could skew automated contrast checks | — | Fade is 160 ms and disabled under `prefers-reduced-motion`; tests wait for it | a11y spec | Noted |

Keyboard-only sign-in, skip link and visible focus are covered by an automated test. Screen-reader testing with NVDA/VoiceOver was not possible in this environment and remains a recommended manual check.

## 4. Audit 4 — End-to-end operations and edge cases

**Method:** walked each operational path looking for retry, outage and ordering hazards: double submission, second browser tab, provider retries, website outage, re-import after edits, reschedule into a clash, cancellation releasing a hold, session revocation mid-task, notification retries. Each confirmed hazard got a service-level test against real Postgres; session revocation got a browser test.
**Evidence:** `tests/integration/operations.test.ts` (8 tests) and the new session test in `tests/e2e/security.spec.ts`; `npm test` → 48/48; E2E journeys + security → 20/20; the mobile navigation test passed 3 times in a row after A4-05.

| ID | Sev | Module | Evidence / reproduction | Root cause | Remediation | Test | Result |
|---|---|---|---|---|---|---|---|
| A4-01 | High | Payments | Two payment attempts for one deposit both succeed at the provider (two tabs) → `paid_minor` became twice the invoice and nobody was told | Success handler added the amount without re-checking the invoice | Invoice row locked (`FOR UPDATE`) and checked; an over-payment is recorded as succeeded but not counted, flagged with outcome `duplicate_payment_refund_needed`, an internal booking note, an audit event and a high-priority refund task | `operations › payment retries` | Fixed |
| A4-02 | Medium | Payments | Double click / back button on “Pay” created a fresh payable attempt each time | `startPayment` always inserted | Reuses the same user’s open attempt for the same invoice and amount (2-hour window) | same | Fixed |
| A4-03 | Medium | Website import | Site unreachable → raw `fetch failed`; a 5xx error page was parsed as “0 found” and overwrote the last-import summary | Response status never checked | Fails the whole run with a clear message (HTTP status included) and changes nothing; an empty parse (layout changed) also fails instead of reporting success | `operations › website import` | Fixed |
| A4-04 | Low | Website import | Photo request returning an error page was downloaded before being rejected | Status checked after reading the body | Status checked first; photo errors are listed in the report and the profile is still imported | same | Fixed |
| A4-05 | Low | Mobile navigation | Mobile navigation E2E failed once in about 20 runs: “Menu” tapped before the page hydrated, so nothing opened | The drawer is opened by client JavaScript; on a slow phone, an early tap does nothing | Test waits for hydration. Product impact: a tap in the first moments after load is ignored, and the bottom tab bar (plain links) still works without JS | E2E `@mobile` ×3 | **Open (Low) — documented** |
| A4-06 | — | Booking | Reschedule a booking onto days where the nanny holds another family’s booking | — | Exclusion constraint → `ConflictError`; the booking keeps its original dates | `operations › schedule changes` | Verified |
| A4-07 | — | Booking | Cancel a held booking → can another family now book that nanny? | — | The cancelled booking’s sessions stop blocking; the second acceptance succeeds | same | Verified |
| A4-08 | — | Notifications | Same notification sent 3 times (retried job) | — | Dedupe key → one in-app row | `operations › notifications` | Verified |
| A4-09 | — | Sessions | Session revoked (expiry, “sign out others”, suspension) while a page is open | — | Next action returns “Not signed in”; next navigation redirects to `/login` | E2E security | Verified |

Website re-import is idempotent (re-running creates nothing new) and never overwrites fields edited by Omega or a nanny, or fields that have been verified (both tested). CSV quoting and blank lines are handled.

## 5. Audit 5 — Independent production-readiness review

**Method:** reviewed the system as an outside reviewer deciding whether real families' and children's data could go live. Covered: configuration and boot behaviour, secrets, headers and cookies, scheduled jobs, unbounded data growth, operational dead-ends, documentation, and a clean full run of every suite.
**Evidence:**
- Typecheck clean; lint 0 warnings.
- Unit + integration **53/53**.
- Playwright **29/29** (journeys, security, accessibility; desktop and mobile).
- `npm audit --omit=dev` → 0 vulnerabilities.
- `git ls-files` shows only `.env.example`; no key patterns in tracked files.
- Session cookie is `httpOnly`, `SameSite=Lax`, and `Secure` in production. CSP, HSTS (2 years, preload), `frame-ancestors 'none'` and no `X-Powered-By` header.
- The cron endpoint returns 401 without the bearer token (tested).

| ID | Sev | Module | Evidence | Root cause | Remediation | Test | Result |
|---|---|---|---|---|---|---|---|
| A5-01 | High | Booking operations | A family that accepts a quote and never pays holds the nanny indefinitely, and no one is told | No follow-up on `awaiting_payment` | Hourly job creates one high-priority "Unpaid hold" task after 48 h (never duplicated, never auto-cancels — auto-release is Omega’s policy decision) | `operations › maintenance job` | Fixed (policy open) |
| A5-02 | High | Configuration | Demo mode plus live PayFast credentials would let “payments” succeed without money; a weak `APP_SECRET` was only detected on first use | No boot-time validation | `instrumentation.ts` refuses to start on fatal misconfiguration (weak secret, non-https live URL, demo + live merchant); Administration lists pre-launch warnings | `tests/unit/config-check.test.ts` | Fixed |
| A5-03 | Medium | Test harness | Full Playwright run: 8 tests timed out on “Too many attempts” | The production login limiter (20 per IP per 15 min) correctly throttled the suite’s own logins | Harness clears `login:*` rows before each test (demo DB only); no bypass in application code. The limiter itself stays covered | Full run 29/29 | Fixed |
| A5-04 | Low | Data growth | `rate_limits` rows never deleted | No housekeeping | Hourly job purges windows older than 24 h | Code review | Fixed |
| A5-05 | Low | Handover | `.env.example` was missing `CRON_SECRET`, `CLAMAV_*`, `WEBSITE_URL`, `REQUIRE_STAFF_MFA` | Added after the file was written | Added, with comments | Review | Fixed |
| A5-06 | Low | Documentation | Docs referred to an older test count and 45 tables; self-audit scores were stale | Docs predated this phase | Required document set written and refreshed; stale files replaced | Review | Fixed |
| A5-07 | Medium | Uploads | Carried from A2-12: no malware scanner here | External service | Boot warning, “not scanned” labels; approval of infected files impossible | — | **Open — configure ClamAV** |
| A5-08 | Medium | Headers | CSP permits `'unsafe-inline'` scripts | Next inline bootstrap without nonces | Documented; nonce-based CSP recommended | — | **Open** |
| A5-09 | Medium | Integrations | Email, PayFast, Supabase Storage and deployment have never run against real services | No accounts or credentials (none invented) | Status shown truthfully in Administration; activation steps in INTEGRATIONS.md | — | **Open — needs Omega’s accounts** |

### Readiness verdict
**Not yet production-ready, and not claimed to be.** The application code is a tested release candidate. Go-live is blocked only by items that need Omega’s accounts or external parties:

1. Configure ClamAV.
2. Configure Resend with a verified domain.
3. Complete one PayFast sandbox payment end to end, then switch to live.
4. Set up Supabase Storage.
5. Deploy with managed Postgres, `CRON_SECRET` and the scheduler.
6. Run an external penetration test.
7. Get a legal review of the privacy notice and retention periods.
8. Do a screen-reader pass.
9. Have Omega confirm rates and policies.
