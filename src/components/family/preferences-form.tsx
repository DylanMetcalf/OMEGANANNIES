"use client";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { savePreferencesAction, submitJourneyAction } from "@/app/family/journey-actions";
import { AvailabilityPill } from "./availability-pill";
import { NannyPhoto } from "./nanny-photo";
import { toast } from "@/components/toaster";
import type { Availability } from "@/lib/journey-core";
import type { ActionResult } from "@/components/action-form";

type N = { id: string; name: string; photo: string | null; slug: string; years: number; availability: Availability };
const ORD = ["1st choice", "2nd choice", "3rd choice"];

/** Steps 3–5: rank up to three preferred nannies (or ask Omega), confirm details, and send the request. */
export function PreferencesForm({ shortlist, initialPrefs, initialHelp, locations, hasKids }: { shortlist: N[]; initialPrefs: string[]; initialHelp: boolean; locations: { id: string; label: string }[]; hasKids: boolean }) {
  const [prefs, setPrefs] = useState<string[]>(initialPrefs.filter((p) => shortlist.some((n) => n.id === p)));
  const [help, setHelp] = useState(initialHelp || !shortlist.length);
  const [state, action, pending] = useActionState(submitJourneyAction, null as ActionResult);
  const toggle = (id: string) => setPrefs((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? (toast("You can choose up to three preferences."), p) : [...p, id]));
  const move = (id: string, d: -1 | 1) => setPrefs((p) => { const i = p.indexOf(id), j = i + d; if (j < 0 || j >= p.length) return p; const c = [...p]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const byId = (id: string) => shortlist.find((n) => n.id === id)!;
  const fdFrom = (form: HTMLFormElement) => { const fd = new FormData(form); fd.delete("prefs"); prefs.forEach((p) => fd.append("prefs", p)); return fd; };
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!pending) startTransition(() => action(fdFrom(e.currentTarget))); };
  const saveLater = async (form: HTMLFormElement | null) => { if (!form) return; const r = await savePreferencesAction(null, fdFrom(form)); toast(r?.ok ?? r?.error ?? "Saved"); };
  return (
    <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
      <section className="card p-5 sm:p-6" aria-labelledby="pref-h">
        <h2 id="pref-h" className="text-[18px]">Your preferred nannies</h2>
        <p className="mt-1 text-[14px] text-muted">Tap to choose up to three, in order of preference. We&rsquo;ll ask your first choice first.</p>
        {shortlist.length ? (
          <ul className="mt-4 grid gap-2">
            {shortlist.map((n) => {
              const rank = prefs.indexOf(n.id);
              return (
                <li key={n.id} className={`flex items-center gap-3 rounded-[12px] border p-2.5 transition-colors ${rank >= 0 ? "border-navy bg-navy-50" : "border-line"}`}>
                  <button type="button" onClick={() => toggle(n.id)} aria-pressed={rank >= 0} className="flex flex-1 items-center gap-3 text-left">
                    <span className="w-14 shrink-0 overflow-hidden rounded-[10px]"><NannyPhoto name={n.name} src={n.photo} sizes="56px" /></span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{n.name}</span><span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">{n.years} years<AvailabilityPill a={n.availability} /></span></span>
                    <span className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold ${rank >= 0 ? "bg-navy text-white" : "bg-sand text-muted"}`}>{rank >= 0 ? <><Check aria-hidden className="h-3.5 w-3.5" />{ORD[rank]}</> : "Choose"}</span>
                  </button>
                  {rank >= 0 && prefs.length > 1 && <span className="flex flex-col">
                    <button type="button" onClick={() => move(n.id, -1)} disabled={rank === 0} className="btn-ghost !min-h-8 !px-2" aria-label={`Move ${n.name} up`}><ArrowUp aria-hidden className="h-4 w-4" /></button>
                    <button type="button" onClick={() => move(n.id, 1)} disabled={rank === prefs.length - 1} className="btn-ghost !min-h-8 !px-2" aria-label={`Move ${n.name} down`}><ArrowDown aria-hidden className="h-4 w-4" /></button>
                  </span>}
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-4 rounded-[12px] bg-cream p-4 text-[14px]">Your shortlist is empty. <Link className="link" href="/family/book/nannies">Browse nannies</Link>, or let Omega choose for you below.</p>}
        {prefs.length > 0 && <p className="mt-3 text-[13px] text-navy" aria-live="polite">Your order: {prefs.map((p, i) => `${i + 1}. ${byId(p).name}`).join("  ·  ")}</p>}
        <label className="mt-4 flex gap-3 rounded-[12px] border border-line p-3.5 text-[14px] has-[:checked]:border-navy has-[:checked]:bg-navy-50">
          <input type="checkbox" name="assistance" checked={help} onChange={(e) => setHelp(e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy" />
          <span><strong className="font-semibold">Ask Omega to suggest someone{prefs.length ? " as well" : ""}</strong><span className="block text-muted">A founder reviews your needs personally and recommends the best available nanny.</span></span>
        </label>
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="where-h">
        <h2 id="where-h" className="text-[18px]">Final details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="serviceLocationId">Address for care</label>
            <select id="serviceLocationId" name="serviceLocationId" defaultValue={locations[0]?.id ?? ""} className="input">{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}<option value="">I&rsquo;ll confirm later</option></select>
            <p className="mt-1 text-[12px] text-muted">Only shared with your nanny once the booking is confirmed. <Link className="link" href="/family/my-family?tab=addresses">Add an address</Link></p>
          </div>
          <div><label className="label" htmlFor="notes">Message for Omega (optional)</label><textarea id="notes" name="notes" rows={2} maxLength={1000} className="input" /></div>
        </div>
        {!hasKids && <p className="mt-4 rounded-[10px] bg-warn-50 px-3 py-2 text-[13px] text-warn">Please add your children in <Link className="link" href="/family/my-family?tab=children">My Family</Link> before sending — we need their ages to match safely.</p>}
        <label className="mt-5 flex gap-2.5 text-[14px]"><input type="checkbox" name="terms" required className="mt-1 h-4 w-4 accent-navy" /><span>I understand this is a <strong>request</strong>, not a confirmed booking. Omega checks availability and sends a quotation; nothing is charged now. I agree to the <a className="link" href="https://omeganannies.com/terms">terms</a>.</span></label>
      </section>

      <div aria-live="polite">{state?.error && <p role="alert" className="rounded-[10px] bg-bad-50 px-3 py-2 text-[13px] font-medium text-bad">{state.error}</p>}</div>
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
        <button className="btn-cta flex-1 sm:flex-none" disabled={pending || (!prefs.length && !help) || !hasKids}>{pending ? "Sending your request…" : "Send booking request"}</button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={(e) => saveLater(e.currentTarget.form)}>Save and finish later</button>
        {!prefs.length && !help && <p className="w-full text-[13px] text-muted">Choose at least one nanny, or ask Omega to suggest someone.</p>}
      </div>
    </form>
  );
}
