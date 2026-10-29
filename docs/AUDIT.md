# Phase-zero audit (29 Oct 2026)

## 1. What exists
- **Repository:** empty on arrival (no commits). The portal is therefore a new application; nothing to preserve or migrate.
- **Public website (omeganannies.com):** Laravel + Vite build (`/build/assets`, `/storage/images`), Tailwind CSS. Pages: home, about, our-nannies, rates, FAQ (20 Q&As), vetting, visiting/resident families, 6 service pages, 5 area pages, privacy, terms, login/register (Laravel auth, not part of this repo).
- **Brand:** navy `#1a2340`, gold `#c8922a`, cream `#f7f3ee`, sand `#ede5d8`, text `#2c3347`; Cormorant Garamond (display) + DM Sans (body); logo `omega-full-logo.png`.
- **Enquiry form:** name, email, phone, area, start/end date, children count + ages, country, nanny type, length, live-in/out, notes, POPIA consent; promise of a 4-hour response, 7 days a week.
- **Positioning:** founder-led, referral- and invitation-only nanny network; all nannies interviewed, police-clearance verified, First Aid certified, reference checked; replacement guarantee; meet-before-you-book.

## 2. Reused
Brand tokens, logo, typography, tone of voice, service catalogue (6 services), area list, public rates, FAQ content (imported verbatim with source URL), the vetting checklist (which became the 5 safeguarding checks the matching engine enforces), and the enquiry form fields (which define the `/api/enquiries` handoff contract).

## 3. Missing capabilities (now built)
Accounts and roles, children's records, availability, matching, quotations, payments, invoices, messaging, documents, reviews, reporting, audit trail, notifications. The website has no API, so the portal provides one.

## 4. Architectural risks
- Two systems (Laravel site + portal). Mitigation: the portal owns operational records. The site keeps marketing content and posts enquiries via a signed webhook. Approved nanny profiles are exposed at `/api/public/nannies` for the site to consume.
- Calendly may already be used informally. Its events never confirm bookings and are only logged for review.

## 5. Security and privacy risks
Children's medical data, identity documents, police clearances and precise addresses are the most sensitive records. The design responses are permission-gated visibility, nanny access only after confirmation, private storage with signed 5-minute links, audit on every sensitive view, and location data that is never stored historically.

## 6. Business rules needing confirmation
| # | Topic | Finding | Current default |
|---|---|---|---|
| 1 | **Rates conflict** | `/rates`: R300/h, R2 200/day. Service pages: "from R200/h, R1 650/day, R27 500/month". | Price book v1 uses `/rates`. **Confirm.** |
| 2 | Public holiday premium, overnight fee, travel fee | "Quoted separately" — no values published. | 50%, R450/night, R250/trip — placeholders marked TO CONFIRM. |
| 3 | Deposit and cancellation | Not published. | 30% deposit, 50% late-cancellation fee — placeholders. |
| 4 | Hourly vs daily | Unclear when the daily rate applies. | Cheaper of hourly (4h minimum) or daily + hourly overtime. |
| 5 | SEN/PT premium | 20–25%. | 20%, editable. |
| 6 | Resident family pricing | "Contact us". | No resident price items, so the system refuses to auto-price and management issues a bespoke quote. |
| 7 | Nanny compensation | Not described. | No payout module; shows engagements only. |
| 8 | Refund policy, retention periods, message oversight policy | Not described. | Proposed defaults in Administration; legal review needed. |
| 9 | Payment provider | None visible. | PayFast adapter built (ZAR, ITN verification); needs a merchant account. |
| 10 | Review publication | Not described. | All reviews moderated before publication. |

## 7. Implementation sequence followed
Foundation (schema, auth, RBAC, design system) → core data (families, children, nannies, vetting, documents, pricing, availability) → booking engine (requests, matching, quotations, holds, confirmation) → communications and money (messaging, notifications, payments, invoices, receipts, reviews, meetings) → operations (reports, help centre, assistant, location sharing, admin) → hardening (tests, security headers, rate limits, E2E, visual review).
