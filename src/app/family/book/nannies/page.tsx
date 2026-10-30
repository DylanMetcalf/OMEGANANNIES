import Form from "next/form";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { SlidersHorizontal, X } from "lucide-react";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { dates as fmtDates } from "@/components/booking/parts";
import { DiscoverCard } from "@/components/family/discover-card";
import { FilterSubmit } from "@/components/family/filter-submit";
import { JourneySteps } from "@/components/family/journey-steps";
import { NannyPhoto } from "@/components/family/nanny-photo";
import { ProfileDrawer } from "@/components/family/profile-drawer";
import { ProfilePreview } from "@/components/family/profile-preview";
import { ShortlistBar } from "@/components/family/shortlist-bar";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { availabilityFor, getDraft, ratingsFor, recentlyViewed, recordView, shortlistOf, visibleNannies } from "@/lib/journey";
import { AGE_GROUPS, FILTER_KEYS, filterAndSort, paginate, parseFilters, parseReq, reqToParams, WEEKDAYS } from "@/lib/journey-core";
import { publicNanny } from "@/lib/nannies";
import { services } from "@/lib/queries";
import { AREAS, LANGUAGES } from "@/db/seed/reference";
import { deleteSavedSearchAction, saveSearchAction } from "../../journey-actions";

export const metadata = { title: "Choose nannies" };
type SP = Record<string, string | undefined>;
const SORTS = [["match", "Best match"], ["experience", "Most experienced"], ["rating", "Highest rated"], ["name", "Name"]] as const;

export default async function Discover({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser({ role: "family" });
  const sp = await searchParams;
  const [familyId] = await familyIdsOf(u.id);
  const draft = await getDraft(familyId);
  // Requirements come from the URL when present (keeps context across steps), otherwise from the saved draft.
  const req = sp.service || sp.start ? parseReq(sp) : draft.req;
  const f = parseFilters(sp);
  const reqQs = reqToParams(req);
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(reqQs);
    for (const k of [...FILTER_KEYS, "page"]) if (sp[k]) p.set(k, sp[k]!);
    for (const [k, v] of Object.entries(patch)) if (v === null) p.delete(k); else p.set(k, v);
    return `?${p}`;
  };
  const all = await visibleNannies();
  const ids = all.map((n) => n.id);
  const [avail, ratings, shortlist, svcList, saved, recent] = await Promise.all([
    availabilityFor(ids, req), ratingsFor(ids), shortlistOf(familyId), services(),
    db.select().from(s.savedSearches).where(eq(s.savedSearches.familyId, familyId)).orderBy(desc(s.savedSearches.createdAt)).limit(10), recentlyViewed(familyId, 6),
  ]);
  const svc = Object.fromEntries(svcList.map((x) => [x.code, x.name]));
  const results = filterAndSort(all, req, f, avail, ratings);
  const { items, pages } = paginate(results, f.page);
  const skills = [...new Set(all.flatMap((n) => n.skills))].sort().slice(0, 30);

  let preview: React.ReactNode = null;
  if (sp.preview && /^[a-z0-9-]{1,80}$/.test(sp.preview)) {
    const p = await publicNanny(sp.preview);
    if (p) {
      await recordView(familyId, p.n.id);
      preview = <ProfileDrawer closeHref={href({ preview: null })} title={`Profile preview: ${p.n.displayName}`}><ProfilePreview p={p} saved={shortlist.includes(p.n.id)} availability={avail[p.n.id] ?? null} svc={svc} closeHref={href({ preview: null })} /></ProfileDrawer>;
    }
  }
  const active: [string, string][] = [
    ...(f.q ? [["q", `“${f.q}”`]] as [string, string][] : []), ...(f.area ? [["farea", f.area]] as [string, string][] : []), ...(f.lang ? [["flang", f.lang]] as [string, string][] : []),
    ...(f.minExp ? [["fexp", `${f.minExp}+ years`]] as [string, string][] : []), ...(f.age ? [["fage", AGE_GROUPS.find(([k]) => k === f.age)?.[1] ?? f.age]] as [string, string][] : []),
    ...(f.skill ? [["fskill", f.skill]] as [string, string][] : []), ...(f.drives ? [["fdrive", "Drives"]] as [string, string][] : []), ...(f.rating ? [["frating", "4★ and up"]] as [string, string][] : []), ...(f.avail ? [["favail", "Free on my dates"]] as [string, string][] : []),
  ];
  const hasReq = !!req.service && !!req.start;
  const summary = [svc[req.service], req.start && fmtDates({ startDate: req.start, endDate: req.end || req.start }), req.recurring && req.weekdays.length ? req.weekdays.map((w) => WEEKDAYS[(w + 6) % 7]).join(", ") : null, req.service !== "live_in" && req.start ? `${req.t1}–${req.t2}` : null, req.area].filter(Boolean);
  const hidden = [...reqQs.entries()];
  return (
    <>
      <JourneySteps current={1} />
      <PageHeader eyebrow="Choose nannies" title={hasReq ? "Nannies who fit your needs" : "Our nannies"} description={hasReq ? <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{summary.map((x, i) => <span key={i} className="after:ml-2 after:text-line after:content-['·'] last:after:content-none">{x}</span>)}<Link href="/family/book" className="link text-[14px]">Edit</Link></span> : <>Tell us your dates to see who is free. <Link className="link" href="/family/book">Add your needs</Link></>} />

      <Form action="/family/book/nannies" scroll={false} className="card mb-4 p-3 sm:p-4" role="search" aria-label="Search and filter nannies">
        {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="q" className="sr-only">Search by name, skill or interest</label>
          <input id="q" name="q" defaultValue={f.q} placeholder="Search by name, skill or interest" className="input sm:flex-1" />
          <label htmlFor="sort" className="sr-only">Sort</label>
          <select id="sort" name="sort" defaultValue={f.sort} className="input sm:!w-48">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <FilterSubmit />
        </div>
        <details className="group mt-2" open={active.some(([k]) => k !== "q")}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[8px] px-1 py-1.5 text-[14px] font-medium text-navy [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal aria-hidden className="h-4 w-4" />More filters{active.length ? <span className="rounded-full bg-navy px-1.5 text-[11px] font-semibold leading-5 text-white">{active.length}</span> : null}
          </summary>
          <div className="mt-2 grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label" htmlFor="farea">Covers area</label><select id="farea" name="farea" defaultValue={f.area} className="input"><option value="">Any</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div><label className="label" htmlFor="flang">Speaks</label><select id="flang" name="flang" defaultValue={f.lang} className="input"><option value="">Any</option>{LANGUAGES.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div><label className="label" htmlFor="fexp">Experience</label><select id="fexp" name="fexp" defaultValue={String(f.minExp || "")} className="input"><option value="">Any</option><option value="2">2+ years</option><option value="5">5+ years</option><option value="10">10+ years</option></select></div>
            <div><label className="label" htmlFor="fage">Experienced with</label><select id="fage" name="fage" defaultValue={f.age} className="input"><option value="">Any age</option>{AGE_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="label" htmlFor="fskill">Skill</label><select id="fskill" name="fskill" defaultValue={f.skill} className="input"><option value="">Any</option>{skills.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2 pb-2 text-[14px] sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-2"><input type="checkbox" name="favail" value="1" defaultChecked={f.avail} disabled={!hasReq} className="h-4 w-4 accent-navy" />Free on my dates</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="fdrive" value="1" defaultChecked={f.drives} className="h-4 w-4 accent-navy" />Drives</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="frating" value="4" defaultChecked={!!f.rating} className="h-4 w-4 accent-navy" />Rated 4★ and up</label>
            </div>
          </div>
        </details>
      </Form>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] text-muted" aria-live="polite"><strong className="text-ink tabular-nums">{results.length}</strong> {results.length === 1 ? "nanny" : "nannies"}</p>
          {active.map(([k, l]) => <Link key={k} href={href({ [k]: null, page: null })} scroll={false} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 text-[12px] font-medium text-navy hover:bg-navy/10" aria-label={`Remove filter ${l}`}>{l}<X aria-hidden className="h-3.5 w-3.5" /></Link>)}
          {active.length > 0 && <Link href={`?${reqQs}`} scroll={false} className="text-[13px] link">Clear filters</Link>}
        </div>
        <details className="relative">
          <summary className="btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">Saved searches{saved.length ? ` (${saved.length})` : ""}</summary>
          <div className="absolute right-0 z-30 mt-2 w-[min(92vw,340px)] rounded-[12px] border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
            <ActionForm action={saveSearchAction} className="flex gap-2" resetOnSuccess>
              {hidden.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {FILTER_KEYS.filter((k) => sp[k]).map((k) => <input key={k} type="hidden" name={k} value={sp[k]} />)}
              <label htmlFor="ss-name" className="sr-only">Name this search</label><input id="ss-name" name="name" placeholder="Name this search" maxLength={60} className="input" />
              <Submit className="btn-secondary btn-sm" pendingText="Saving…">Save</Submit>
            </ActionForm>
            {saved.length ? <ul className="mt-3 divide-y divide-line text-[14px]">{saved.map((x) => { const p = x.params as { req: Record<string, string>; filters: Record<string, string> }; return (
              <li key={x.id} className="flex items-center justify-between gap-2 py-2"><Link className="link truncate" href={`?${new URLSearchParams({ ...p.req, ...p.filters })}`}>{x.name}</Link>
                <ActionForm action={deleteSavedSearchAction}><input type="hidden" name="id" value={x.id} /><Submit className="btn-ghost btn-sm" pendingText="…">Remove</Submit></ActionForm></li>); })}</ul>
              : <p className="mt-3 text-[13px] text-muted">Save this search to come back to the same filters later. We won&rsquo;t send alerts.</p>}
          </div>
        </details>
      </div>

      {items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((n) => <DiscoverCard key={n.id} n={n} saved={shortlist.includes(n.id)} previewHref={href({ preview: n.slug })} svc={svc} />)}
        </div>
      ) : (
        <Empty title="No nannies match all of that" action={<div className="flex flex-wrap justify-center gap-2">{active.length > 0 && <Link href={`?${reqQs}`} className="btn-secondary">Clear filters</Link>}<Link href="/family/book/review?help=1" className="btn-primary">Ask Omega to find someone</Link></div>}>
          Try fewer filters or different dates — or let us search for you. We often have nannies who aren&rsquo;t listed publicly yet.
        </Empty>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-1">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => <Link key={p} href={href({ page: String(p) })} aria-current={p === f.page ? "page" : undefined} className={`inline-flex h-10 min-w-10 items-center justify-center rounded-[10px] px-3 text-[14px] font-medium ${p === f.page ? "bg-navy text-white" : "text-ink hover:bg-sand"}`}>{p}</Link>)}
        </nav>
      )}

      {recent.length > 0 && (
        <section className="mt-10" aria-labelledby="recent-h">
          <h2 id="recent-h" className="mb-3 text-[17px]">Recently viewed</h2>
          <ul className="flex gap-3 overflow-x-auto pb-2">{recent.map((n) => <li key={n.id} className="w-[132px] shrink-0"><Link href={href({ preview: n.slug })} scroll={false} className="card card-link block overflow-hidden"><NannyPhoto name={n.displayName} src={n.photoUrl} sizes="132px" /><p className="truncate px-2.5 py-2 text-[13px] font-medium">{n.displayName}</p></Link></li>)}</ul>
        </section>
      )}
      <ShortlistBar initial={shortlist.length} />
      {preview}
    </>
  );
}

