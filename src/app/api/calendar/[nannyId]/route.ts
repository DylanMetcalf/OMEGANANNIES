import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { hmac, safeEqual } from "@/lib/crypto";

/**
 * Read-only iCalendar feed of a nanny's confirmed sessions (subscribe in Google/Apple/Outlook).
 * Contains booking references and times only — no family names, addresses or children's details.
 */
export async function GET(req: Request, { params }: { params: Promise<{ nannyId: string }> }) {
  const id = (await params).nannyId.replace(/\.ics$/, "");
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!safeEqual(hmac(`ics:${id}`), token)) return new Response("Not found", { status: 404 });
  const rows = await db.select({ x: s.bookingSessions, ref: s.bookings.reference, status: s.bookings.status }).from(s.bookingSessions).innerJoin(s.bookings, eq(s.bookings.id, s.bookingSessions.bookingId)).where(and(eq(s.bookingSessions.nannyId, id), eq(s.bookingSessions.blocking, true)));
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ev = rows.map(({ x, ref, status }) => `BEGIN:VEVENT\r\nUID:${x.id}@omeganannies\r\nDTSTAMP:${f(new Date())}\r\nDTSTART:${f(x.startsAt)}\r\nDTEND:${f(x.endsAt)}\r\nSUMMARY:Omega booking ${ref}${status === "awaiting_payment" ? " (held)" : ""}\r\nEND:VEVENT`).join("\r\n");
  return new Response(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Omega Nannies//Portal//EN\r\nX-WR-CALNAME:Omega Nannies bookings\r\n${ev}${ev ? "\r\n" : ""}END:VCALENDAR\r\n`, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
