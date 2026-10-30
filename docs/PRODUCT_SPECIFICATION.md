# Product specification

The Omega Nannies Operating System is the private operational platform behind [omeganannies.com](https://omeganannies.com). The public site keeps marketing content and enquiries. The platform runs everything after an enquiry: nanny onboarding and vetting, matching, bookings, quotations, payments, messaging and reporting. Status markers: **Built** (implemented and tested) · **Needs config** (built, but needs an external account) · **Not built**.

## 1. Roles
| Role | Who | Access |
|---|---|---|
| Family | Parents and authorised household members | Their own household only. Separate "can book" and "can pay" permissions per member |
| Nanny | Vetted carers | Their own profile, documents and assigned bookings. Family address and care notes are hidden until the configured reveal point |
| Ops | Omega coordinators | Only the permissions granted to them (17 granular permissions) |
| Manager / Admin | Omega leadership | All operations. Admin also manages staff, settings and the audit log |

Two-step verification (TOTP) is mandatory for all staff outside the demo.

## 2. Family Portal — Built
Discover approved nannies (with filters), view a profile, and shortlist favourites. Request a booking for date ranges or chosen weekdays (for example Mon/Wed/Fri), with live-in, overnight, driver, language, specialist care and budget options. Track a clear progress journey. Accept a quotation with terms. Pay the deposit and then the balance (PayFast — **Needs config**; a demo provider is used in demo). Download receipts. Manage children's profiles (routines, allergies, emergency instructions, recorded consent) and household documents. Use messages and notifications, leave reviews, and book again.

## 3. Nanny Portal — Built
- **Claim and onboarding:** claim a pre-created profile from an invitation, then follow a guided onboarding (confirm details, upload ID, police clearance and first aid documents and a photo, submit for review).
- **Today view:** the day's schedule.
- **Booking offers:** accept or decline offers. While an offer is pending, the nanny sees the area only.
- **Booking work:** booking details, check-in, completion and opt-in location sharing.
- **Calendar:** weekly availability, time off and a calendar (ICS) feed.
- **Profile changes:** edits go through a review workflow. Fields the nanny confirms are marked "confirmed by nanny".

## 4. Management Portal — Built
- **Overview:** work queues.
- **Bookings list:** paginated.
- **Booking workspace:** explainable matching, assignment with an audited override, nanny response tracking, quotation builder, rescheduling, EFT recording, refunds and the timeline.
- **Nannies:**
  - A lifecycle board with stage filters.
  - Create a profile without an email.
  - Website import and CSV import.
  - Provenance per field, with "verify".
  - Single and bulk invitations, with revoke and resend.
  - Safeguarding checks and document review (showing scan status).
  - Approve, publish, unpublish, suspend, archive and reopen.
- **Tasks:** internal tasks linked to bookings, nannies or families. Tasks are created automatically for duplicate payments and unpaid holds.
- **Other areas:**
  - Families.
  - Versioned pricing.
  - Reports with CSV export.
  - Help content.
  - Support and review moderation.
- **Administration:**
  - Staff, permissions and MFA.
  - Integration status and pre-launch configuration warnings.
  - Booking and privacy rules.
  - Retention settings.
  - Audit log.

## 5. Account (all roles) — Built
Profile, email change (re-enter the password, then confirm the new address; the old address is notified), password change (signs out other sessions), notification preferences, active sessions with "sign out others", a JSON export of your own data (POPIA), privacy requests, and account closure.

## 6. Nanny lifecycle
`draft → awaiting_invitation → invitation_sent (or invitation_expired) → awaiting_documents → awaiting_verification → onboarding_incomplete → pending_approval → approved → published`, plus `suspended` and `archived`.

The stage is derived from data (profile, invitation, documents, checks), not typed in by hand, so it cannot drift. Approval requires:
- a claimed account;
- all 5 safeguarding checks passed and current (interview, reference, identity, police clearance, first aid);
- the 3 required documents approved.

Publishing requires approval.

## 7. Booking lifecycle
`enquiry → matching → (introduction) → quotation → awaiting_approval → awaiting_payment → confirmed → in_progress → completed`, plus `declined`, `cancelled`, `refund_pending`, `refunded` and `disputed`. When "nanny acceptance required" is on (the default), a quotation can only be sent once the assigned nanny has accepted. The nanny is held from the moment the family accepts the quotation, and confirmation happens only on a verified payment.

## 8. Configurable rules (Administration → Booking & privacy rules)
| Setting | Options | Default |
|---|---|---|
| Address and care-note reveal | on confirmation · on the first care day | on confirmation |
| Nanny must accept before quoting | yes · no | yes |
| Retention periods | months/years | proposed defaults (legal review needed) |

## 9. Business decisions still open
See [DISCOVERY.md §6](DISCOVERY.md): rates (the website shows two conflicting price sets), deposit %, cancellation fees, holiday, overnight and travel fees, refund policy, nanny compensation, retention, payment provider account, and whether unpaid holds auto-release (currently they are flagged to management after 48 h and never cancelled automatically).

## 10. Final refinement phase — what changed (Built unless marked)
- **Guided booking journey** (`/family/book` → `/family/book/nannies` → `/family/book/review`):
  1. *Your needs*: service, one day / several days / weekly pattern, times, area (not the address), children or age groups, optional languages, driving, specialist care, minimum experience and notes. Conditional questions; validation; "Save for later".
  2. *Choose nannies*: photo-led grid of approved profiles with real availability for the requested sessions (holds, time off, synced calendar busy times). It has:
     - search, sort, an expandable filter panel and active-filter chips;
     - result count and pagination;
     - saved searches (no alerts) and recently viewed;
     - a profile preview drawer that keeps the grid, filters and page.
  3. *Review & send*:
     - Rank up to three preferred nannies, or "Ask Omega to suggest someone" (this creates a management task).
     - Summary with edit links and an indicative price estimate from the published price book.
     - Address chosen only here.
     - Terms. Then the request is sent: never confirmed or charged automatically.
- **All entry points share the journey:**
  - "Book a nanny" (sidebar and phone centre action) and "Find a nanny".
  - The dashboard, a saved nanny's "Select" button, "Book again" (copies preferences only).
  - Website links via `/start?intent=book&service=<slug>`.
  - The old URLs, which redirect.
  - The draft is stored server-side, so "Continue booking" works on any device.
- **Full profile:** sections 1–9 (introduction, experience, qualifications from current check records, skills, languages, relevant childcare experience, availability, reviews, other). Reviews are verified and moderated; an average is shown only from 3+ reviews; families can report a review.
- **Shortlist** (persistent, per family) and **comparison** (2–4 nannies, public facts only).
- **Progress tracker** from the real booking state: request received → preferences submitted → Omega reviewing → nanny confirming → quotation → your approval → deposit → confirmed. Each stage has a "what happens next" line.
- **My Family** replaces Household + Children: Household (incl. emergency contact), Children, Addresses, Household members.
- **Family dashboard:** attention cards (quotes, payments, unfinished request, profile completion, messages), upcoming care, requests in progress, shortlist / recently viewed, updates, support.
- **Website ↔ portal:** website links in the sidebar and mobile menu; `/start` entry route; safe `next=` after sign-in.
- **Primary CTA:** brighter gold (`cta` #9F6A00, white text 4.63:1) with hover/active/disabled/busy states. **Phone:** a raised, role-aware centre action:
  - Family: "Book a nanny" or "Continue booking"; "Shortlist" while browsing.
  - Nanny: "Review offer" or "My availability".
  - Management: "New requests".
- **Welcome moment** once after sign-in (≈1 s, dismissible, reduced-motion aware); pending/skeleton feedback; restrained motion.
- **Two-way calendar sync** (Google, Outlook) — *Built; needs OAuth app credentials.*
- **Multi-channel notifications** (in-app, email, SMS, WhatsApp) with a preference matrix — *SMS/WhatsApp need Twilio; WhatsApp needs approved templates.*
- **Referrals & loyalty** — *Built, switched off until Omega approves terms.*
- **Management insights** (`/manage/insights`) with filters and CSV export.
