import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hmac } from "@/lib/crypto";
import { env } from "@/lib/env";
import { nannyOf } from "@/lib/bookings";
import { fmtDate, fmtDateTime, minutesToHHMM } from "@/lib/time";
import { addExceptionAction, removeExceptionAction, saveWeeklyAction } from "../actions";

export const metadata = { title: "Availability" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export default async function Availability() {
  const u = await requireUser({ role: "nanny" });
  const n = await nannyOf(u.id);
  if (!n) return <Empty title="Profile not linked" />;
  const rules = await db.select().from(s.availabilityRules).where(eq(s.availabilityRules.nannyId, n.id));
  const exc = await db.select().from(s.availabilityExceptions).where(and(eq(s.availabilityExceptions.nannyId, n.id), gt(s.availabilityExceptions.endsAt, new Date()))).orderBy(asc(s.availabilityExceptions.startsAt));
  const booked = await db.select({ x: s.bookingSessions, ref: s.bookings.reference }).from(s.bookingSessions).innerJoin(s.bookings, eq(s.bookings.id, s.bookingSessions.bookingId)).where(and(eq(s.bookingSessions.nannyId, n.id), eq(s.bookingSessions.blocking, true), gt(s.bookingSessions.endsAt, new Date()))).orderBy(asc(s.bookingSessions.startsAt)).limit(30);
  const feed = `${env.appUrl}/api/calendar/${n.id}.ics?t=${hmac(`ics:${n.id}`)}`;
  return (
    <>
      <PageHeader eyebrow="Availability" title="When you can work" description="Omega uses this to match you. Confirmed bookings always take priority and can't overlap — the system prevents double-booking." />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Section title="Weekly pattern">
          <ActionForm action={saveWeeklyAction} className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => {
              const r = rules.find((x) => x.weekday === w);
              return (
                <div key={w} className="grid grid-cols-[120px_1fr_1fr] items-center gap-2 sm:grid-cols-[140px_140px_140px]">
                  <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name={`on-${w}`} defaultChecked={!!r} className="accent-navy" />{DAYS[w]}</label>
                  <input aria-label={`${DAYS[w]} from`} type="time" name={`from-${w}`} defaultValue={r ? minutesToHHMM(r.startMinute) : "08:00"} className="input !py-1.5" />
                  <input aria-label={`${DAYS[w]} to`} type="time" name={`to-${w}`} defaultValue={r ? (r.endMinute >= 1439 ? "23:59" : minutesToHHMM(r.endMinute)) : "18:00"} className="input !py-1.5" />
                </div>
              );
            })}
            <div className="pt-2"><Submit>Save weekly pattern</Submit></div>
          </ActionForm>
        </Section>
        <div className="space-y-6">
          <Section title="Time off & exceptions">
            <ActionForm action={addExceptionAction} className="grid grid-cols-2 gap-3" resetOnSuccess>
              <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" required className="input" /></div>
              <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" className="input" /></div>
              <div><label className="label" htmlFor="kind">Type</label><select id="kind" name="kind" className="input"><option value="unavailable">Unavailable</option><option value="leave">Leave</option><option value="available">Extra availability</option></select></div>
              <div><label className="label" htmlFor="reason">Note</label><input id="reason" name="reason" className="input" /></div>
              <div className="col-span-2"><Submit className="btn-secondary">Add</Submit></div>
            </ActionForm>
            <ul className="mt-4 divide-y divide-line text-[14px]">{exc.map((e) => <li key={e.id} className="flex items-center justify-between py-2"><span><span className="capitalize">{e.kind}</span> · {fmtDate(e.startsAt)} – {fmtDate(new Date(e.endsAt.getTime() - 1))}{e.reason && <span className="text-muted"> · {e.reason}</span>}</span><ActionForm action={removeExceptionAction}><input type="hidden" name="id" value={e.id} /><Submit className="btn-ghost btn-sm">Remove</Submit></ActionForm></li>)}</ul>
          </Section>
          <Section title="Booked time">
            {booked.length ? <ul className="space-y-1.5 text-[14px]">{booked.map(({ x, ref }) => <li key={x.id}>{fmtDateTime(x.startsAt)} – {fmtDateTime(x.endsAt)} <span className="text-muted">· {ref}</span></li>)}</ul> : <p className="text-[14px] text-muted">No booked time.</p>}
          </Section>
          <Section title="Calendar sync">
            <p className="text-[13px] text-muted">Subscribe to your confirmed bookings in Google, Apple or Outlook Calendar. The feed contains times and references only. Calendar events don&rsquo;t change bookings — the portal is the source of truth.</p>
            <input readOnly value={feed} aria-label="Calendar feed URL" className="input mt-3 font-mono text-[12px]" />
          </Section>
        </div>
      </div>
    </>
  );
}
