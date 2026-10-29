import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";

export async function nannyBookings(nannyId: string, statuses: string[]) {
  return db.select({ b: s.bookings, area: s.serviceLocations.area, family: s.families.displayName }).from(s.bookings)
    .leftJoin(s.serviceLocations, eq(s.serviceLocations.id, s.bookings.serviceLocationId)).leftJoin(s.families, eq(s.families.id, s.bookings.familyId))
    .where(and(eq(s.bookings.nannyId, nannyId), inArray(s.bookings.status, statuses as never[]))).orderBy(asc(s.bookings.startDate));
}
export function profileCompletion(n: typeof s.nannies.$inferSelect, docs: number) {
  const items: [string, boolean][] = [["Headline", !!n.headline], ["Biography (80+ characters)", (n.bio ?? "").length >= 80], ["Languages", n.languages.length > 0], ["Skills", n.skills.length > 0], ["Service areas", n.areas.length > 0], ["Profile photo", !!n.photoUrl], ["Documents uploaded", docs > 0]];
  return { pct: Math.round((items.filter(([, ok]) => ok).length / items.length) * 100), missing: items.filter(([, ok]) => !ok).map(([k]) => k) };
}
