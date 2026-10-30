import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/auth";
import { bookingAccess } from "@/lib/bookings";
import { minutesToHHMM } from "@/lib/time";

/**
 * Old "Request a nanny" URL. All entry points now share the guided journey. "Book again" copies preferences only —
 * dates, availability and pricing are always re-checked, and the family reviews everything before sending.
 */
export default async function NewBooking({ searchParams }: { searchParams: Promise<{ nanny?: string; repeat?: string }> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  if (sp.repeat && /^[0-9a-f-]{36}$/.test(sp.repeat)) {
    const [prev] = await db.select().from(s.bookings).where(eq(s.bookings.id, sp.repeat));
    if (prev && (await bookingAccess(u, prev)).level === "family") {
      const kids = await db.select().from(s.bookingChildren).where(eq(s.bookingChildren.bookingId, prev.id));
      const [loc] = prev.serviceLocationId ? await db.select().from(s.serviceLocations).where(eq(s.serviceLocations.id, prev.serviceLocationId)) : [];
      const p = new URLSearchParams({ service: prev.serviceCode, t1: minutesToHHMM(prev.dailyStartMinute), t2: minutesToHHMM(prev.dailyEndMinute), kids: kids.map((k) => k.childId).join(","), again: "1" });
      if (loc?.area ?? prev.areaText) p.set("area", (loc?.area ?? prev.areaText)!);
      if (prev.requiredLanguages.length) p.set("langs", prev.requiredLanguages.join(","));
      if (prev.needsDriver) p.set("driver", "1");
      redirect(`/family/book?${p}`);
    }
  }
  redirect("/family/book");
}
