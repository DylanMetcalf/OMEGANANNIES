# Audit log

Five progressive audit-and-improvement cycles. Each finding records evidence, root cause, remediation and the test that now guards it. Severity: Critical · High · Medium · Low · Info.

| Cycle | Focus | Findings | Fixed | Open |
|---|---|---|---|---|
| 1 | Baseline functionality & integrity | 14 | 14 | 0 |
| 2 | Security, privacy & data integrity | 12 | 11 | 1 (documented) |
| 3 | Design, UI/UX & accessibility | 9 | 9 | 0 |
| 4 | End-to-end operations & edge cases | see §4 | | |
| 5 | Independent production-readiness review | see §5 | | |

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
