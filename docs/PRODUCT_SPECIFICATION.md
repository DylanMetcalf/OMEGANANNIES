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
