import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { dates, hours } from "@/components/booking/parts";
import { Empty, Notice, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { respondOfferAction } from "./actions";
import { requireUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { nannyBookings, profileCompletion } from "@/lib/nanny-data";
import { services, unreadMessages } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata = { title: "Today" };
export default async function NannyHome() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked">Please contact Omega Nannies to link your profile.</Empty>;
  const today = new Date().toISOString().slice(0, 10);
  const active = await nannyBookings(n.id, ["confirmed", "in_progress"]);
  const pipeline = await nannyBookings(n.id, ["matching", "introduction", "quotation", "awaiting_approval", "awaiting_payment"]);
  const offers = pipeline.filter(({ b }) => b.nannyResponse === "pending");
  const intros = pipeline.filter(({ b }) => b.nannyResponse !== "pending");
  const docs = await db.select().from(s.documents).where(eq(s.documents.ownerNannyId, n.id));
  const checks = await db.select().from(s.verificationChecks).where(and(eq(s.verificationChecks.nannyId, n.id), sql`${s.verificationChecks.expiresOn} <= (current_date + 45)`));
  const meetings = await db.select({ m: s.meetings, ref: s.bookings.reference }).from(s.meetings).innerJoin(s.bookings, eq(s.bookings.id, s.meetings.bookingId)).where(and(eq(s.bookings.nannyId, n.id), sql`${s.meetings.startsAt} > now()`, sql`${s.meetings.status} <> 'cancelled'`));
  const svc = Object.fromEntries((await services()).map((x) => [x.code, x.name]));
  const comp = profileCompletion(n, docs.length);
  const now = active.filter(({ b }) => b.startDate <= today && b.endDate >= today);
  return (
    <>
      <PageHeader eyebrow={new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" }).format(new Date())} title={`Hello, ${n.displayName.split(" ")[0]}`}  />
      {checks.map((c) => <div key={c.id} className="mb-3"><Notice tone={c.expiresOn! < today ? "bad" : "warn"} title={`${c.kind.replace("_", " ")} ${c.expiresOn! < today ? "expired" : "expires " + fmtDate(c.expiresOn!)}`}>Upload a renewed copy under <Link className="link" href="/nanny/documents">Documents</Link> to stay bookable.</Notice></div>)}
      {offers.length > 0 && (
        <section className="card mb-6 border-gold/40 p-5" aria-labelledby="offers-h">
          <h2 id="offers-h" className="text-[16px]">Booking offers waiting for you</h2>
          <ul className="mt-3 divide-y divide-line">{offers.map(({ b, area }) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-semibold">{dates(b)} · {hours(b)}</p><p className="text-[13px] text-muted">{svc[b.serviceCode]} · {area ?? b.areaText ?? "Area to be confirmed"}</p></div>
              <div className="flex gap-2">
                <ActionForm action={respondOfferAction}><input type="hidden" name="bookingId" value={b.id} /><Submit name="response" value="accept" className="btn-primary btn-sm">Accept</Submit></ActionForm>
                <ActionForm action={respondOfferAction} confirm="Decline this booking offer?"><input type="hidden" name="bookingId" value={b.id} /><Submit name="response" value="decline" className="btn-secondary btn-sm">Decline</Submit></ActionForm>
              </div>
            </li>
          ))}</ul>
        </section>
      )}
      {n.status !== "approved" && <div className="mb-6"><Notice tone="info" title="Finish setting up your profile">Complete your onboarding so Omega can approve you. <Link className="link" href="/nanny/onboarding">Continue</Link></Notice></div>}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={now.length} hint={now.length ? "booking in progress" : "No care today"} />
        <Stat label="Upcoming" value={active.length} href="/nanny/bookings" />
        <Stat label="Unread messages" value={await unreadMessages(u.id)} href="/messages" />
        <Stat label="Profile" value={`${comp.pct}%`} hint={comp.missing[0] ? `Add: ${comp.missing[0]}` : "Complete"} href="/nanny/profile" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Section title="Your schedule" action={<Link href="/nanny/availability" className="text-[13px] link">Availability</Link>}>
          {active.length ? <ul className="-my-2 divide-y divide-line">{active.map(({ b, area }) => (
            <li key={b.id}><Link href={`/nanny/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium text-navy">{dates(b)} · {hours(b)}</p><p className="text-[13px] text-muted">{svc[b.serviceCode]} · {area ?? b.areaText} · {b.reference}</p></div><StatusBadge status={b.status} /></Link></li>
          ))}</ul> : <Empty title="No confirmed bookings">Keep your availability up to date so Omega can match you.</Empty>}
        </Section>
        <div className="space-y-6">
          <Section title="Introductions & pending">
            {intros.length || meetings.length ? <ul className="space-y-3 text-[14px]">
              {meetings.map(({ m, ref }) => <li key={m.id}><p className="font-medium text-navy">Intro call · {fmtDateTime(m.startsAt)}</p><p className="text-[12px] text-muted">{ref} · {m.provider.replace("_", " ")}{m.joinUrl && <> · <a href={m.joinUrl} className="link" target="_blank" rel="noopener noreferrer">Join</a></>}</p></li>)}
              {intros.map(({ b }) => <li key={b.id}><Link href={`/nanny/bookings/${b.id}`} className="block"><p className="font-medium text-navy">{dates(b)}</p><p className="text-[12px] text-muted">{svc[b.serviceCode]} · not yet confirmed</p></Link></li>)}
            </ul> : <p className="text-[14px] text-muted">Nothing pending.</p>}
          </Section>
          {comp.missing.length > 0 && <Section title="Complete your profile"><div className="mb-3 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full bg-gold" style={{ width: `${comp.pct}%` }} /></div><ul className="list-disc pl-5 text-[14px] text-muted">{comp.missing.map((m) => <li key={m}>{m}</li>)}</ul></Section>}
        </div>
      </div>
    </>
  );
}
