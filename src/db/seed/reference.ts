/**
 * Reference data shared by production bootstrap and demo seeding.
 * Source: omeganannies.com (fetched 2026-10-29). Prices conflict across pages — see docs/AUDIT.md §6.
 * Price book v1 is created as DRAFT for production; demo seeding publishes it.
 */
export const SERVICES = [
  { code: "holiday", name: "Holiday Nanny", description: "Attentive, engaging care while you travel, from a few hours to full days.", sortOrder: 1 },
  { code: "live_in", name: "Live-In Nanny", description: "A dedicated member of your household for longer stays.", sortOrder: 2 },
  { code: "event", name: "Event Nanny", description: "Dedicated childcare during weddings, functions and celebrations.", sortOrder: 3 },
  { code: "granny", name: "Granny Nanny", description: "Professional childcare with a lifetime of nurturing experience.", sortOrder: 4 },
  { code: "night", name: "Night Nanny", description: "Bedtime routines, overnight care and newborn support.", sortOrder: 5 },
  { code: "special_needs", name: "Special Needs & Teaching Nanny", description: "Experienced support for diverse learning, developmental and care requirements.", sortOrder: 6 },
];

const R = (rand: number) => rand * 100;
/** From omeganannies.com/rates (visiting & international families). Resident pricing is bespoke (quoted). */
export const PRICE_ITEMS_V1 = [
  { code: "hourly", unit: "hour", amount: R(300), label: "Hourly care" },
  { code: "min_hours", unit: "hours", amount: 4, label: "Minimum hours per booking day" },
  { code: "daily", unit: "day", amount: R(2200), label: "Daily care (10-hour day)" },
  { code: "day_hours", unit: "hours", amount: 10, label: "Hours in a daily-rate day" },
  { code: "livein_daily", unit: "day", amount: R(3500), label: "24/7 live-in — daily" },
  { code: "livein_weekly", unit: "week", amount: R(18900), label: "24/7 live-in — weekly" },
  { code: "livein_monthly", unit: "day", amount: R(2250), label: "24/7 live-in — monthly (per day)" },
  { code: "specialist_premium", unit: "bps", amount: 2000, label: "Specialist add-on (SEN / PT)" },
  // Not published on the website — placeholders that MUST be confirmed by management before production.
  { code: "public_holiday_premium", unit: "bps", amount: 5000, label: "Public holiday premium (TO CONFIRM)" },
  { code: "overnight_fee", unit: "flat", amount: R(450), label: "Overnight fee per night (TO CONFIRM)" },
  { code: "travel_fee", unit: "flat", amount: R(250), label: "Travel fee per trip (TO CONFIRM)" },
  { code: "deposit", unit: "bps", amount: 3000, label: "Deposit to confirm (TO CONFIRM)" },
  { code: "cancellation_fee", unit: "bps", amount: 5000, label: "Late cancellation fee (TO CONFIRM)" },
].map((i) => ({ ...i, audience: "visiting", serviceCode: null as string | null }));

export const PUBLIC_HOLIDAYS = [
  ["2026-12-16", "Day of Reconciliation"], ["2026-12-25", "Christmas Day"], ["2026-12-26", "Day of Goodwill"],
  ["2027-01-01", "New Year's Day"], ["2027-03-21", "Human Rights Day"], ["2027-03-22", "Human Rights Day (observed)"], ["2027-03-26", "Good Friday"], ["2027-03-29", "Family Day"],
  ["2027-04-27", "Freedom Day"], ["2027-05-01", "Workers' Day"], ["2027-06-16", "Youth Day"], ["2027-08-09", "National Women's Day"],
  ["2027-09-24", "Heritage Day"], ["2027-12-16", "Day of Reconciliation"], ["2027-12-25", "Christmas Day"], ["2027-12-26", "Day of Goodwill"], ["2027-12-27", "Day of Goodwill (observed)"],
].map(([day, name]) => ({ day, name }));

export const AREAS = ["Atlantic Seaboard", "City Bowl & Waterfront", "Southern Suburbs", "Cape Winelands", "Garden Route"];
export const LANGUAGES = ["English", "Afrikaans", "isiXhosa", "German", "French", "Dutch", "Shona", "Portuguese"];
export const SKILLS = ["Swimming supervision", "Homework support", "Newborn care", "Sleep routines", "Arts & crafts", "Outdoor play", "Meal preparation", "Sign language", "Montessori approach", "Travel experience"];

export const HELP_ARTICLES = [
  { slug: "how-booking-works", title: "How booking works in the portal", category: "Booking process", audience: "public", body: "1. Submit a booking request with your dates, times, location and children.\n2. Our team matches you with suitable, vetted nannies and may arrange a video introduction.\n3. You receive a quotation in the portal. Review and accept it.\n4. Pay the deposit shown on your invoice. Your booking is only confirmed once payment has been verified by our payment provider (or our team records your EFT).\n5. Your nanny receives the care instructions for your children.\n\nA request is never a confirmed booking until you see the Confirmed status." },
  { slug: "payments-and-deposits", title: "Payments, deposits and invoices", category: "Payments", audience: "public", body: "Quotations show the full price, the deposit needed to confirm and the balance. Invoices and receipts are available under Payments. We never store card details — card payments are processed by our payment provider. If you've paid by EFT, our team records the payment once it reflects." },
  { slug: "cancellations", title: "Cancelling or changing a booking", category: "Cancellation policy", audience: "public", body: "You can cancel a request at any time before it's confirmed from the booking page. For confirmed bookings, cancellation fees and refunds follow the terms in your quotation. Our team reviews every refund individually — the portal and assistant cannot promise a refund. To change dates, message our team from the booking page; we'll check your nanny's availability and confirm any price change before it applies." },
  { slug: "children-information", title: "Why we ask about your children", category: "Family onboarding", audience: "family", body: "We ask only for what helps your nanny care for your children safely: preferred name, age, routines, allergies, dietary needs and emergency instructions. Medical and allergy details are visible to your assigned nanny only once a booking is confirmed, and to authorised Omega staff. You can update or remove this information at any time." },
  { slug: "nanny-documents", title: "Keeping your documents current", category: "Nanny onboarding", audience: "nanny", body: "Upload your police clearance, First Aid certificate and identity document under Documents. Files are stored privately and reviewed by the Omega team. You'll receive reminders 30 days before a document expires. Expired safeguarding documents make you temporarily unavailable for new placements." },
  { slug: "location-sharing", title: "Location sharing during bookings", category: "Portal guidance", audience: "public", body: "During a confirmed booking a nanny can choose to share their location with the family for a limited time, for example on an outing. Sharing is always opt-in, shows a clear indicator, ends automatically and can be stopped at any time. We keep only the most recent location and delete it when sharing ends. A manual check-in note is available when live location isn't possible." },
  { slug: "messaging-policy", title: "Messages and who can read them", category: "Portal guidance", audience: "public", body: "Messages are stored securely in the portal. Families and nannies can message each other once a booking is confirmed. Omega's team may review conversations for safeguarding and support purposes; every such access is logged. Please report any message that concerns you using the Report button." },
];
