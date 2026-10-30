# Testing strategy

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Static | `tsc --noEmit`, ESLint (`next lint`) | CI / local | Types end to end; no lint warnings |
| Unit | Vitest | `tests/unit` | Money and pricing rounding, PayFast signatures, time and session building (weekdays, UTC conversion), state machine permissions, matching rules, configuration guard |
| Integration | Vitest against **real PostgreSQL** | `tests/integration` | Booking flow end to end; security (invitation claim races, token reuse, cross-family isolation, address reveal, concurrent acceptance, idempotency); operations (re-imports, outages, duplicate payments, reschedule conflicts, cancellation releasing holds, notification dedupe, maintenance job) |
| End to end | Playwright (Chromium, desktop and Pixel 7) | `tests/e2e/journeys.spec.ts` | Registration with email verification; family booking → nanny offer acceptance → quotation → payment → confirmation; pre-created nanny profile → invite → wrong-email claim refused → claim → onboarding → approval gates → publish → visible to families; mobile navigation |
| Security (HTTP) | Playwright | `tests/e2e/security.spec.ts` | Signed document links bound to the user; draft photos hidden; data export scoped; role boundaries on direct URLs; revoked sessions |
| Accessibility | `@axe-core/playwright` | `tests/e2e/a11y.spec.ts` | 33 pages × desktop and mobile: zero serious or critical WCAG 2.2 A/AA violations; keyboard-only sign-in, skip link, visible focus |
| Dependencies | `npm audit --omit=dev` | local | 0 known vulnerabilities |

## Running
```bash
npm run typecheck && npm run lint
TEST_DATABASE_URL=postgres://omega:omega@localhost:5432/omega_test npm test
bash scripts/restart.sh && npm run test:e2e     # demo database only (enforced by global-setup)
```
E2E runs only against a database in which every user is `is_demo`. The harness clears **login** throttling between tests, because a full run signs in more often than the production limit allows; no bypass exists in application code.

## Not covered automatically (manual or external)
Screen readers (NVDA/VoiceOver), real email delivery, live PayFast sandbox, Supabase Storage, ClamAV, load testing, penetration testing. See KNOWN_LIMITATIONS.md.
