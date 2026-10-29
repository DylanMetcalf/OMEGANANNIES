"use client";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/action-form";
import { requestBookingAction } from "@/app/family/actions";

type Opt = { id: string; label: string };
export function BookingRequestForm({ services, kids, locations, nannies, languages, defaults, idempotencyKey, today }: {
  services: { code: string; name: string }[]; kids: Opt[]; locations: Opt[]; nannies: Opt[]; languages: string[]; today: string; idempotencyKey: string;
  defaults: { serviceCode?: string; nannyId?: string; startTime?: string; endTime?: string; childIds?: string[]; locationId?: string };
}) {
  const [service, setService] = useState(defaults.serviceCode ?? "holiday");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const liveIn = service === "live_in";
  return (
    <ActionForm action={requestBookingAction} className="space-y-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="card p-5">
        <legend className="px-1 font-display text-[16px] font-bold text-ink">1. The care you need</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {services.map((s) => (
            <label key={s.code} className={`cursor-pointer rounded-[10px] border p-3 text-[14px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${service === s.code ? "border-navy bg-navy-50 text-navy" : "border-line hover:border-navy/40"}`}>
              <input type="radio" name="serviceCode" value={s.code} checked={service === s.code} onChange={() => setService(s.code)} className="sr-only" />{s.name}
            </label>
          ))}
        </div>
        <div className="mt-4"><label className="label" htmlFor="requestedNannyId">Preferred nanny (optional)</label>
          <select id="requestedNannyId" name="requestedNannyId" defaultValue={defaults.nannyId ?? ""} className="input"><option value="">Match me with the best available nanny</option>{nannies.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
        </div>
      </fieldset>
      <fieldset className="card p-5">
        <legend className="px-1 font-display text-[16px] font-bold text-ink">2. When</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="startDate">Start date</label><input id="startDate" name="startDate" type="date" min={today} required value={start} onChange={(e) => setStart(e.target.value)} className="input" /></div>
          <div><label className="label" htmlFor="endDate">End date</label><input id="endDate" name="endDate" type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} className="input" aria-describedby="end-hint" /><p id="end-hint" className="mt-1 text-[12px] text-muted">Leave empty for a single day.</p></div>
          {!liveIn && <>
            <div><label className="label" htmlFor="startTime">Daily start</label><input id="startTime" name="startTime" type="time" step={900} defaultValue={defaults.startTime ?? "09:00"} className="input" /></div>
            <div><label className="label" htmlFor="endTime">Daily finish</label><input id="endTime" name="endTime" type="time" step={900} defaultValue={defaults.endTime ?? "17:00"} className="input" aria-describedby="time-hint" /><p id="time-hint" className="mt-1 text-[12px] text-muted">Hourly bookings have a 4-hour minimum. A finish before the start runs overnight.</p></div>
          </>}
          {liveIn && <p className="rounded-lg bg-cream p-3 text-[13px] text-muted sm:col-span-2">Live-in care is 24/7 for the dates you choose. We&rsquo;ll agree days off and routines with you.</p>}
        </div>
        {!liveIn && end && end > start && (
          <fieldset className="mt-4">
            <legend className="label">Which days? <span className="font-normal text-muted">(leave all ticked for every day)</span></legend>
            <div className="flex flex-wrap gap-2">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => <label key={d} className="chip"><input type="checkbox" name="weekdays" value={(i + 1) % 7} defaultChecked className="sr-only" />{d}</label>)}</div>
          </fieldset>
        )}
        {!liveIn && <label className="mt-4 flex items-center gap-2 text-[14px]"><input type="checkbox" name="overnight" className="h-4 w-4 accent-navy" />Includes overnight care</label>}
      </fieldset>
      <fieldset className="card p-5">
        <legend className="px-1 font-display text-[16px] font-bold text-ink">3. Who and where</legend>
        {kids.length ? <div className="mt-3 flex flex-wrap gap-2">{kids.map((c) => <label key={c.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[14px]"><input type="checkbox" name="childIds" value={c.id} defaultChecked={defaults.childIds?.includes(c.id) ?? true} className="accent-navy" />{c.label}</label>)}</div>
          : <p className="mt-3 text-[14px] text-bad">Add your children first under <a className="link" href="/family/children">Children</a>.</p>}
        <div className="mt-4"><label className="label" htmlFor="serviceLocationId">Location</label>
          <select id="serviceLocationId" name="serviceLocationId" defaultValue={defaults.locationId ?? locations[0]?.id ?? ""} className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}<option value="">To be confirmed</option></select>
          <p className="mt-1 text-[12px] text-muted">Your exact address is only shared with your nanny once the booking is confirmed. <a className="link" href="/family/profile#locations">Add a location</a></p>
        </div>
      </fieldset>
      <fieldset className="card p-5">
        <legend className="px-1 font-display text-[16px] font-bold text-ink">4. Preferences</legend>
        <div className="mt-3 flex flex-wrap gap-4 text-[14px]">
          <label className="flex items-center gap-2"><input type="checkbox" name="needsDriver" className="accent-navy" />Nanny must drive</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="specialistCare" className="accent-navy" />Additional-needs / specialist care</label>
        </div>
        <div className="mt-4"><p className="label">Required languages</p><div className="flex flex-wrap gap-2">{languages.map((l) => <label key={l} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px]"><input type="checkbox" name="languages" value={l} className="accent-navy" />{l}</label>)}</div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
          <div><label className="label" htmlFor="budget">Budget (optional)</label><input id="budget" name="budget" inputMode="decimal" placeholder="R" className="input" /></div>
          <div><label className="label" htmlFor="specialRequests">Anything else we should know?</label><textarea id="specialRequests" name="specialRequests" rows={3} maxLength={2000} className="input" placeholder="Routines, outings, swimming, pets…" /></div>
        </div>
      </fieldset>
      <div className="card p-5">
        <label className="flex gap-2.5 text-[14px]"><input type="checkbox" name="terms" required className="mt-1 accent-navy" /><span>I understand this is a <strong>request</strong>, not a confirmed booking. Omega will confirm availability and send a quotation; booking terms, fees and cancellation policy are set out in the quotation. I agree to the <a className="link" href="https://omeganannies.com/terms">terms</a>.</span></label>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Submit className="btn-gold" pendingText="Sending request…">Send booking request</Submit><span className="text-[13px] text-muted">We respond within 4 hours, 7 days a week.</span></div>
      </div>
    </ActionForm>
  );
}
