import { z } from "zod";
import { db, schema as s } from "@/db";
import { hmac, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { newReference } from "@/lib/bookings";
import { buildSessions } from "@/lib/time";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

/**
 * Website → portal enquiry handoff. The Laravel site POSTs the existing enquiry form as JSON with
 * header `X-Omega-Signature: <base64url HMAC-SHA256 of the raw body with WEBSITE_WEBHOOK_SECRET>`.
 * Creates an ENQUIRY booking (no account yet). Idempotent on `enquiryId`.
 */
const Body = z.object({
  enquiryId: z.string().min(1).max(100), firstName: z.string().max(80), lastName: z.string().max(80), email: z.string().email(), phone: z.string().max(40).optional(),
  area: z.string().max(120), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  children: z.string().max(200), country: z.string().max(80).optional(), nannyType: z.string().max(60), notes: z.string().max(2000).optional(), consent: z.literal(true),
});
const TYPE: Record<string, string> = { "Holiday Nanny": "holiday", "Event Nanny": "event", "Granny Nanny": "granny", "Night Nanny": "night", "Special Needs & Teaching Nanny": "special_needs", Nanny: "holiday", "Live In": "live_in" };

export async function POST(req: Request) {
  if (!env.websiteSecret) return Response.json({ error: "Website integration not configured" }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-omega-signature") ?? "";
  if (!safeEqual(hmac(raw, env.websiteSecret), sig)) return Response.json({ error: "bad signature" }, { status: 401 });
  if (!(await rateLimit("enquiries:website", 300, 3600))) return Response.json({ error: "rate limited" }, { status: 429 });
  const parsed = Body.safeParse(JSON.parse(raw));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) }, { status: 422 });
  const e = parsed.data;
  const endDate = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate;
  const res = await db.transaction(async (tx) => {
    const [b] = await tx.insert(s.bookings).values({
      reference: newReference(), serviceCode: TYPE[e.nannyType] ?? "holiday", status: "enquiry", startDate: e.startDate, endDate, dailyStartMinute: 540, dailyEndMinute: 1020,
      areaText: e.area, enquiryName: `${e.firstName} ${e.lastName}`.trim(), enquiryEmail: e.email.toLowerCase(), enquiryPhone: e.phone, enquiryChildren: e.children,
      specialRequests: [e.country && `Enquiring from ${e.country}.`, e.notes].filter(Boolean).join(" ") || null, source: "website", idempotencyKey: `website:${e.enquiryId}`,
    }).onConflictDoNothing().returning();
    if (!b) return null;
    await tx.insert(s.bookingSessions).values(buildSessions({ startDate: e.startDate, endDate, dailyStartMinute: 540, dailyEndMinute: 1020, timeZone: "Africa/Johannesburg" }).map((x) => ({ bookingId: b.id, startsAt: x.startsAt, endsAt: x.endsAt })));
    await tx.insert(s.bookingEvents).values({ bookingId: b.id, toStatus: "enquiry", kind: "status", note: "Enquiry received from omeganannies.com" });
    await tx.insert(s.consents).values({ email: e.email.toLowerCase(), policy: "privacy_enquiry", version: "website", granted: true });
    await audit(null, "enquiry.website", "booking", b.id, { enquiryId: e.enquiryId }, tx);
    return b;
  });
  await db.insert(s.integrationConfigs).values({ key: "website", enabled: true, lastSuccessAt: new Date() }).onConflictDoUpdate({ target: s.integrationConfigs.key, set: { lastSuccessAt: new Date() } });
  return Response.json(res ? { reference: res.reference, status: "created" } : { status: "duplicate" }, { status: res ? 201 : 200 });
}
