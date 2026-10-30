"use client";
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, CalendarRange, Repeat, ChevronDown } from "lucide-react";
import { saveRequirementsAction } from "@/app/family/journey-actions";
import { toast } from "@/components/toaster";
import { AGE_GROUPS, WEEKDAYS, type Req } from "@/lib/journey-core";
import type { ActionResult } from "@/components/action-form";

type Kid = { id: string; label: string };
type Mode = "day" | "range" | "weekly";
const Err = ({ m }: { m?: string }) => (m ? <p role="alert" className="mt-1.5 text-[13px] font-medium text-bad">{m}</p> : null);
const Q = ({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) => (
  <fieldset className="card p-5 sm:p-6">
    <legend className="sr-only">{title}</legend>
    <div className="mb-4 flex items-baseline gap-3"><span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[13px] font-bold text-white">{n}</span><div><p className="font-display text-[17px] font-bold text-ink">{title}</p>{hint && <p className="text-[13px] text-muted">{hint}</p>}</div></div>
    {children}
  </fieldset>
);

/** Step 1 of the booking journey: a short, conditional set of questions instead of one long form. */
export function RequirementsForm({ req, services, kids, areas, languages, today }: { req: Req; services: { code: string; name: string; description?: string | null }[]; kids: Kid[]; areas: string[]; languages: string[]; today: string }) {
  const [state, action, pending] = useActionState(async (p: ActionResult, fd: FormData) => { const r = await saveRequirementsAction(p, fd); if (r?.ok && fd.get("intent") === "save") toast(r.ok); return r; }, null);
  const fe = (state?.fieldErrors ?? {}) as Partial<Record<keyof Req, string>>;
  const [service, setService] = useState(req.service);
  const [mode, setMode] = useState<Mode>(req.recurring ? "weekly" : req.end && req.end !== req.start ? "range" : "day");
  const [start, setStart] = useState(req.start);
  const [intent, setIntent] = useState<"find" | "save">("find");
  const [more, setMore] = useState(req.langs.length > 0 || req.driver || req.specialist || req.minExp > 0 || !!req.notes);
  const liveIn = service === "live_in";
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null);
    setIntent(fd.get("intent") === "save" ? "save" : "find");
    startTransition(() => action(fd));
  };
  const modes: [Mode, string, typeof CalendarDays][] = [["day", "One day", CalendarDays], ["range", "Several days in a row", CalendarRange], ["weekly", "Repeating each week", Repeat]];
  return (
    <form action={action} onSubmit={submit} className="space-y-5" aria-busy={pending} noValidate>
      {mode === "weekly" && <input type="hidden" name="recurring" value="1" />}
      <Q n={1} title="What kind of care do you need?">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Service">
          {services.map((s) => (
            <label key={s.code} className={`cursor-pointer rounded-[12px] border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${service === s.code ? "border-navy bg-navy-50" : "border-line hover:border-navy/40"}`}>
              <input type="radio" name="service" value={s.code} checked={service === s.code} onChange={() => setService(s.code)} className="sr-only" />
              <span className="block text-[14px] font-semibold text-ink">{s.name}</span>
              {s.description && <span className="mt-0.5 block line-clamp-2 text-[12px] text-muted">{s.description}</span>}
            </label>
          ))}
        </div>
        <Err m={fe.service} />
      </Q>

      <Q n={2} title="When?" hint={liveIn ? "Live-in care is around the clock for the dates you choose." : "Choose a pattern — you can refine details later."}>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pattern">
          {modes.map(([m, l, I]) => (
            <label key={m} className={`flex cursor-pointer items-center gap-2.5 rounded-[12px] border px-3.5 py-3 text-[14px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${mode === m ? "border-navy bg-navy-50 text-navy" : "border-line hover:border-navy/40"}`}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" /><I aria-hidden className="h-[18px] w-[18px]" />{l}
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="start">{mode === "day" ? "Date" : "Start date"}</label><input id="start" name="start" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!fe.start} className="input" /><Err m={fe.start} /></div>
          {mode !== "day" && <div><label className="label" htmlFor="end">{mode === "weekly" ? "Repeat until" : "End date"}</label><input id="end" name="end" type="date" min={start || today} defaultValue={req.end} aria-invalid={!!fe.end} className="input" /><Err m={fe.end} /></div>}
          {!liveIn && <>
            <div><label className="label" htmlFor="t1">Start time</label><input id="t1" name="t1" type="time" step={900} defaultValue={req.t1} className="input" /></div>
            <div><label className="label" htmlFor="t2">Finish time</label><input id="t2" name="t2" type="time" step={900} defaultValue={req.t2} aria-invalid={!!fe.t2} className="input" aria-describedby="t2h" /><p id="t2h" className="mt-1 text-[12px] text-muted">A finish before the start runs overnight. Hourly care has a 4-hour minimum.</p><Err m={fe.t2} /></div>
          </>}
        </div>
        {mode === "weekly" && (
          <fieldset className="mt-4"><legend className="label">On which days?</legend>
            <div className="flex flex-wrap gap-2">{WEEKDAYS.map((d, i) => { const v = (i + 1) % 7; return <label key={d} className="chip"><input type="checkbox" name="weekdays" value={v} defaultChecked={req.weekdays.includes(v)} className="sr-only" />{d}</label>; })}</div>
            <Err m={fe.weekdays} />
          </fieldset>
        )}
      </Q>

      <Q n={3} title="Where, and for whom?" hint="An area is enough for now. Your full address is only shared with your nanny once a booking is confirmed.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="area">Area</label><select id="area" name="area" defaultValue={req.area} aria-invalid={!!fe.area} className="input"><option value="">Choose an area</option>{areas.map((a) => <option key={a}>{a}</option>)}</select><Err m={fe.area} /></div>
        </div>
        {kids.length ? (
          <fieldset className="mt-4"><legend className="label">Who is the care for?</legend>
            <div className="flex flex-wrap gap-2">{kids.map((k) => <label key={k.id} className="chip"><input type="checkbox" name="kids" value={k.id} defaultChecked={req.kids.length ? req.kids.includes(k.id) : true} className="sr-only" />{k.label}</label>)}</div>
            <Err m={fe.kids} />
          </fieldset>
        ) : (
          <fieldset className="mt-4"><legend className="label">Your children&rsquo;s ages</legend>
            <div className="flex flex-wrap gap-2">{AGE_GROUPS.map(([v, l]) => <label key={v} className="chip"><input type="checkbox" name="ages" value={v} defaultChecked={req.ages.includes(v)} className="sr-only" />{l}</label>)}</div>
            <p className="mt-2 text-[12px] text-muted">Before sending your request you&rsquo;ll add each child&rsquo;s name and date of birth in <a className="link" href="/family/my-family?tab=children">My Family</a>.</p>
            <Err m={fe.ages} />
          </fieldset>
        )}
      </Q>

      <div className="card overflow-hidden">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="more-prefs" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6">
          <span><span className="font-display text-[16px] font-bold text-ink">Preferences</span> <span className="text-[13px] text-muted">— optional</span></span>
          <ChevronDown aria-hidden className={`h-5 w-5 text-muted transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
        <div id="more-prefs" hidden={!more} className="border-t border-line px-5 pb-5 pt-4 sm:px-6">
          <p className="label">Languages the nanny must speak</p>
          <div className="flex flex-wrap gap-2">{languages.map((l) => <label key={l} className="chip"><input type="checkbox" name="langs" value={l} defaultChecked={req.langs.includes(l)} className="sr-only" />{l}</label>)}</div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-[14px]">
            <label className="flex items-center gap-2"><input type="checkbox" name="driver" value="1" defaultChecked={req.driver} className="h-4 w-4 accent-navy" />Must drive</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="specialist" value="1" defaultChecked={req.specialist} className="h-4 w-4 accent-navy" />Additional-needs experience</label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
            <div><label className="label" htmlFor="minExp">Minimum experience</label><select id="minExp" name="minExp" defaultValue={String(req.minExp)} className="input"><option value="0">Any</option><option value="2">2+ years</option><option value="5">5+ years</option><option value="10">10+ years</option></select></div>
            <div><label className="label" htmlFor="notes">Anything else?</label><textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={req.notes} className="input" placeholder="Routines, outings, swimming, pets…" /></div>
          </div>
        </div>
      </div>

      <div aria-live="polite">{state?.error && <p role="alert" className="rounded-[10px] bg-bad-50 px-3 py-2 text-[13px] font-medium text-bad">{state.error}</p>}</div>
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
        <button name="intent" value="find" className="btn-cta flex-1 sm:flex-none" disabled={pending}>{pending && intent === "find" ? "Finding nannies…" : "Show matching nannies"}</button>
        <button name="intent" value="save" className="btn-ghost" disabled={pending}>{pending && intent === "save" ? "Saving…" : "Save for later"}</button>
      </div>
    </form>
  );
}
