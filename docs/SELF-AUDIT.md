# Self-audit (evidence-based, 29 Oct 2026)

| Dimension | Score | Evidence | Gap to 9+/10 |
|---|---|---|---|
| Design quality | 8 | Brand tokens from the live site, editorial nanny profiles, consistent component set; screenshots reviewed and fixed (old-style "1" read as "I"; baby ages shown as "0 yrs") | Real photography; a designer pass on dense management screens |
| User experience | 8 | Progress bar for families, plain-language states ("Quote ready for you"), empty states with next actions, mobile actions ordered first | Usability testing with real families and nannies |
| Functional completeness | 8 | All three portals plus help centre; 7 E2E journeys from registration to nanny access | Nanny compensation, refund execution via provider API, calendar two-way sync, file attachments in messages |
| Data integrity | 9 | Exclusion constraint, row locks, idempotency keys, unique webhook events, integer money, snapshotted quotes; integration-tested | — |
| Security & privacy | 8 | RBAC with sensitive-data gating, hashed tokens, MFA, rate limits, signed document links, CSP/HSTS, audit trail; cross-account tests | External pen test, Sentry/log redaction review, legal review |
| Performance | 7 | Server rendering, ~106 kB first load, indexed queries, paginated lists (limits) | Load testing; image CDN for photos; cursor pagination |
| Accessibility | 7 | Labelled inputs, focus rings, skip link, aria-live feedback, reduced-motion, contrast-adjusted muted text | Formal WCAG 2.2 audit with a screen reader |
| Responsive behaviour | 8 | Mobile drawer navigation; E2E check for no horizontal overflow on a Pixel 7 viewport | Tables scroll horizontally on phones; card layouts for management lists |
| Reliability | 8 | Email outbox with retries, webhook replays safe, health endpoint, cron housekeeping | Monitoring/alerting setup |
| Maintainability | 9 | Typed end to end, single policy and status writer, migrations, lint clean, 29 unit/integration + 7 E2E tests | — |
| Operational usefulness | 8 | Overview queues, explainable matching, quote builder, EFT recording, reports, CSV export | Bulk actions, saved filters |
| Brand consistency | 9 | Palette, typography, logo and tone taken from omeganannies.com | — |

**Defects found and fixed during audit:** an enum-array parsing bug that broke management notification fan-out (caught by integration tests); a root `loading.tsx` that stalled server-action redirects about half the time (found in E2E, root-caused, removed); old-style numerals reading as "I" in stat tiles; infant ages showing as "0 yrs"; nanny check-in actions buried on mobile.
