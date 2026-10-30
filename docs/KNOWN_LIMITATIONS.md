# Known limitations

These are stated plainly. None of them is hidden in the UI: Administration shows the configuration-related items live.

## Not verified because the external service isn't available here
| Item | Effect today | Needed |
|---|---|---|
| Malware scanning | Uploads are stored as **"not scanned"** (A2-12) | ClamAV at `CLAMAV_HOST` before accepting real documents |
| Email delivery | Emails are captured in the outbox; invitation links are shown to staff to send by hand | Resend key and a verified domain |
| PayFast | Only signed fixtures and the demo provider have been exercised | Merchant account; one sandbox payment end to end |
| Supabase Storage | Only the local private-disk driver has been exercised | Bucket, keys, and a test upload/download |
| Deployment | Not deployed to a public host | Hosting account, DNS, managed Postgres with `btree_gist` |

## Product gaps (deliberate, or awaiting a business decision)
- No nanny payouts or compensation module (the model is undefined), and no automatic refunds through the provider API (refunds are recorded and handled manually).
- Unpaid holds are **flagged** after 48 h, never auto-released; auto-release is a policy decision.
- Rates, deposit, fees and retention periods are placeholders awaiting confirmation (DISCOVERY.md §6).
- Message attachments, two-way calendar sync, SMS and WhatsApp notifications are not built.
- Website nanny data is imported as unverified drafts only. Omega must review and verify each field, and each nanny must claim and confirm their profile.

## Technical limitations
- CSP allows `'unsafe-inline'` scripts; nonce-based CSP is a recommended hardening step.
- Mobile menu drawer: a tap during the first moments after load, before hydration, does nothing (A4-05). The bottom tab bar works without JavaScript.
- Rate limits are Postgres-based. That is fine for a single region; at high traffic, consider Redis.
- No load testing, penetration test or screen-reader (NVDA/VoiceOver) pass has been carried out.
- Error monitoring (e.g. Sentry) is not wired in.
- The offline mode shows an offline page only; no data is available offline (by design, for privacy).

## Added in the final refinement phase
- **Calendar sync, SMS, WhatsApp and email delivery confirmations** are implemented and tested with fakes and signature fixtures, but have never run against Google, Microsoft, Twilio or Resend (no accounts). WhatsApp business-initiated messages need Meta-approved templates. Until then, message bodies are sent only inside the 24-hour customer window.
- **Calendar sync** writes to the user's primary calendar (no calendar picker yet). Outside edits are surfaced as conflicts, not applied.
- **Demo nanny profiles have no photographs** (the approved demo profiles are synthetic; the 17 real website photos belong to unverified draft profiles and are not shown to families). Cards show a monogram until real, approved photos are added.
- **Price estimates** in the journey are indicative; holiday, travel and overnight fees are confirmed in the quotation.
- **Referral and loyalty programmes** are off; redemptions are recorded manually until Omega defines how credit and points are used.
- **Saved searches** never trigger alerts (by design until consent and rules are agreed).
- **Discovery** loads up to 500 published profiles per request; revisit with server-side pagination if the network grows beyond ~2 000 nannies.
