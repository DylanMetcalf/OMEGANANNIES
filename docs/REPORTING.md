# Metric definitions (`lib/reports.ts`)
| Metric | Definition |
|---|---|
| Bookings created | Bookings with `created_at` in range (service filter optional). |
| Website enquiries | Of those, `source = website`. |
| Conversion | Share of created bookings now in confirmed, in progress, completed, disputed, refund pending or refunded. |
| Net revenue | Sum of succeeded payments by `confirmed_at` minus completed refunds by `completed_at`. |
| Outstanding | Unpaid amounts on open invoices of non-cancelled bookings (all time). |
| Average booking value | Mean `total_minor` of quotations accepted in range. |
| Repeat bookings | Created bookings whose family had an earlier completed booking. |
| Cancellations | Created bookings now cancelled. |
| Average first response | Mean hours from the enquiry event to the first status change out of `enquiry`. |
| Nanny utilisation | Hours of blocking sessions overlapping the range, per approved nanny. |
| Geographic and service demand | Counts by service location area (or enquiry area) and by service. |
| Expiring checks | Passed safeguarding checks expiring within 30 days. |

Empty ranges show empty states; no figures are synthesised.
