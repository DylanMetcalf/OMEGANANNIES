import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { BookingFacts, Journey } from "@/components/booking/parts";
import { LocationSharer } from "@/components/nanny/location-sharer";
import { Notice, PageHeader, Section, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { bookingAccess } from "@/lib/bookings";
import { bookingDetail } from "@/lib/queries";
import { ageFrom, fmtDateTime } from "@/lib/time";
import { bookingStatusAction, checkInNoteAction, startShareAction, stopShareAction } from "../../actions";

export const metadata = { title: "Booking" };
export default async function NannyBooking({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser({ role: "nanny" });
  const d = await bookingDetail((await params).id);
  if (!d) notFound();
  const acc = await bookingAccess(u, d.b);
  if (acc.level !== "nanny") notFound();
  const { b } = d;
  const today = new Date().toISOString().slice(0, 10);
  const onDates = today >= b.startDate && today <= b.endDate;
  const myShare = d.share && d.share.sharerId === u.id ? d.share : null;
  return (
    <>
      <PageHeader eyebrow={`Booking ${b.reference}`} title={d.serviceName} description={<StatusBadge status={b.status} />} actions={d.conversation && acc.sensitive ? <Link href={`/messages/${d.conversation.id}`} className="btn-secondary">Message family</Link> : null} />
      {!acc.sensitive && <div className="mb-6"><Notice tone="info">This booking isn&rsquo;t confirmed yet. Address, contact details and children&rsquo;s care notes appear once it&rsquo;s confirmed.</Notice></div>}
      <div className="card mb-6 p-5"><Journey status={b.status} /></div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Section title="Booking"><BookingFacts d={d} showPreciseLocation={acc.preciseLocation} />{acc.preciseLocation && d.location?.accessNotes && <p className="mt-4 rounded-lg bg-cream p-3 text-[14px]"><strong>Access:</strong> {d.location.accessNotes}</p>}{b.responsibilities && <p className="mt-4 text-[14px]"><strong>Agreed responsibilities:</strong> {b.responsibilities}</p>}</Section>
          {acc.sensitive && (
            <Section title="Children & care instructions">
              <div className="space-y-5">{d.children.map((c) => (
                <div key={c.id} className="rounded-xl border border-line p-4">
                  <p className="font-display text-[22px] text-navy">{c.preferredName}{ageFrom(c.dateOfBirth) !== null && <span className="ml-2 font-sans text-[14px] text-muted">{ageFrom(c.dateOfBirth)} yrs</span>}</p>
                  {c.allergies && <p className="mt-2 rounded-lg bg-bad-50 px-3 py-2 text-[14px] text-bad"><strong>Allergies:</strong> {c.allergies}</p>}
                  <dl className="mt-3 grid gap-2 text-[14px] sm:grid-cols-2">
                    {([["Dietary", c.dietaryNeeds], ["Routines", c.routines], ["Interests", c.interests], ["Care requirements", c.careRequirements], ["Additional needs", c.additionalNeeds], ["Emergency", c.emergencyInstructions]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-[12px] uppercase tracking-wider text-muted">{k}</dt><dd>{v}</dd></div>)}
                  </dl>
                </div>
              ))}</div>
              {d.family?.emergencyContactName && <p className="mt-4 text-[14px]"><strong>Emergency contact:</strong> {d.family.emergencyContactName} · <a className="link" href={`tel:${d.family.emergencyContactPhone}`}>{d.family.emergencyContactPhone}</a></p>}
              <p className="mt-3 text-[12px] text-muted">Confidential. Don&rsquo;t copy or share outside this portal.</p>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          {(b.status === "confirmed" || b.status === "in_progress") && (
            <Section title="Your day">
              {b.status === "confirmed" && onDates && <ActionForm action={bookingStatusAction}><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="to" value="in_progress" /><Submit className="btn-gold w-full">Check in &amp; start</Submit></ActionForm>}
              {b.status === "confirmed" && !onDates && <p className="text-[14px] text-muted">Check-in opens on {b.startDate}.</p>}
              {b.status === "in_progress" && <ActionForm action={bookingStatusAction} confirm="Mark this booking as complete?" className="space-y-2"><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="to" value="completed" /><label className="label" htmlFor="note">Handover note (optional)</label><textarea id="note" name="note" rows={2} className="input" /><Submit className="btn-primary w-full">Mark care complete</Submit></ActionForm>}
            </Section>
          )}
          {acc.sensitive && onDates && (
            <Section title="Location sharing">
              {myShare ? (
                <div className="space-y-3">
                  <LocationSharer bookingId={b.id} expiresAt={myShare.expiresAt.toISOString()} />
                  <p className="text-[12px] text-muted">Visible to this family and Omega until {fmtDateTime(myShare.expiresAt)}.</p>
                  <ActionForm action={stopShareAction}><input type="hidden" name="bookingId" value={b.id} /><Submit className="btn-danger w-full">Stop sharing</Submit></ActionForm>
                </div>
              ) : (
                <ActionForm action={startShareAction} className="space-y-3">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <p className="text-[13px] text-muted">Optional. Share your location with this family for a limited time — e.g. during an outing. Only your latest position is kept and it&rsquo;s deleted when sharing ends.</p>
                  <select name="minutes" aria-label="Duration" className="input" defaultValue="60"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option></select>
                  <Submit className="btn-secondary w-full">Start sharing</Submit>
                </ActionForm>
              )}
              <ActionForm action={checkInNoteAction} className="mt-4 space-y-2 border-t border-line pt-4" resetOnSuccess><input type="hidden" name="bookingId" value={b.id} /><label className="label" htmlFor="ci">Manual check-in</label><input id="ci" name="note" maxLength={280} placeholder="e.g. At Kirstenbosch, back by 3pm" className="input" /><Submit className="btn-ghost btn-sm">Send check-in</Submit></ActionForm>
            </Section>
          )}
          {d.meetings.length > 0 && <Section title="Introductions"><ul className="space-y-2 text-[14px]">{d.meetings.map((m) => <li key={m.id}>{fmtDateTime(m.startsAt)} · {m.provider.replace("_", " ")} · {m.status}{m.joinUrl && <> · <a className="link" href={m.joinUrl} target="_blank" rel="noopener noreferrer">Join</a></>}</li>)}</ul></Section>}
        </div>
      </div>
    </>
  );
}
