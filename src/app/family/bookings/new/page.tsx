import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { BookingRequestForm } from "@/components/family/booking-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { bookingAccess, familyIdsOf } from "@/lib/bookings";
import { searchNannies } from "@/lib/nannies";
import { services } from "@/lib/queries";
import { minutesToHHMM } from "@/lib/time";
import { LANGUAGES } from "@/db/seed/reference";

export const metadata = { title: "Request a nanny" };
export default async function NewBooking({ searchParams }: { searchParams: Promise<{ nanny?: string; repeat?: string }> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  const [familyId] = await familyIdsOf(u.id);
  const [kids, locs, nannies, svc] = await Promise.all([
    db.select().from(s.children).where(eq(s.children.familyId, familyId)), db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, familyId)), searchNannies({ sort: "name" }), services(),
  ]);
  let defaults: Parameters<typeof BookingRequestForm>[0]["defaults"] = { nannyId: sp.nanny };
  if (sp.repeat) {
    // Repeat booking: copy preferences only. Dates, availability and pricing are re-checked from scratch.
    const [prev] = await db.select().from(s.bookings).where(eq(s.bookings.id, sp.repeat));
    if (prev && (await bookingAccess(u, prev)).level === "family") {
      const ch = await db.select().from(s.bookingChildren).where(eq(s.bookingChildren.bookingId, prev.id));
      defaults = { serviceCode: prev.serviceCode, nannyId: prev.nannyId ?? undefined, startTime: minutesToHHMM(prev.dailyStartMinute), endTime: minutesToHHMM(prev.dailyEndMinute), childIds: ch.map((c) => c.childId), locationId: prev.serviceLocationId ?? undefined };
    }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={sp.repeat ? "Book again" : "New request"} title={sp.repeat ? "Book again" : "Request a nanny"} description={sp.repeat ? "We've copied your previous preferences. Choose new dates — we'll check availability and send a fresh quotation." : "Tell us what you need. Our team personally reviews every request."} />
      <BookingRequestForm idempotencyKey={randomUUID()} today={new Date().toISOString().slice(0, 10)} services={svc} languages={LANGUAGES}
        kids={kids.map((k) => ({ id: k.id, label: k.preferredName }))} locations={locs.map((l) => ({ id: l.id, label: `${l.label} · ${l.area}` }))} nannies={nannies.map((n) => ({ id: n.id, label: n.displayName }))} defaults={defaults} />
    </div>
  );
}
