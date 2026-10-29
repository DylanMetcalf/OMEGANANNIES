import Link from "next/link";
import { asc, eq, ilike, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Avatar, Badge, Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { lifecycle, onboardingContext } from "@/lib/onboarding";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import { bulkInviteAction, createNannyAction, csvImportAction, importWebsiteAction } from "../actions";

export const metadata = { title: "Nannies" };
const FILTERS = [["all", "All"], ["setup", "Needs set-up"], ["invited", "Invited"], ["onboarding", "Onboarding"], ["review", "Ready for review"], ["live", "Published"], ["inactive", "Suspended / archived"]] as const;
const GROUP: Record<string, string> = { draft: "setup", awaiting_invitation: "setup", invitation_expired: "setup", invitation_sent: "invited", awaiting_documents: "onboarding", awaiting_verification: "onboarding", onboarding_incomplete: "onboarding", pending_approval: "review", approved: "review", published: "live", suspended: "inactive", archived: "inactive" };

export default async function Nannies({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const u = await requireUser({ perm: "nannies.view" });
  const { f = "all", q } = await searchParams;
  const rows = await db.select({ n: s.nannies, upcoming: sql<number>`(SELECT count(*)::int FROM bookings b WHERE b.nanny_id = ${s.nannies.id} AND b.status IN ('confirmed','in_progress'))`, changes: sql<number>`(SELECT count(*)::int FROM profile_change_requests p WHERE p.nanny_id = ${s.nannies.id} AND p.status = 'pending')` })
    .from(s.nannies).where(q ? ilike(s.nannies.displayName, `%${q}%`) : undefined).orderBy(asc(s.nannies.displayName)).limit(300);
  const ctx = await onboardingContext(rows.map((r) => r.n.id));
  const enriched = rows.map((r) => {
    const stage = lifecycle(r.n, { invitation: ctx.invitations.find((i) => i.nannyId === r.n.id), docs: ctx.docs.filter((d) => d.ownerNannyId === r.n.id), checks: ctx.checks.filter((c) => c.nannyId === r.n.id) });
    const pendingDocs = ctx.docs.filter((d) => d.ownerNannyId === r.n.id && d.status === "pending_review").length;
    return { ...r, stage, pendingDocs };
  });
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? enriched.length : enriched.filter((e) => GROUP[e.stage.key] === k).length]));
  const list = f === "all" ? enriched : enriched.filter((e) => GROUP[e.stage.key] === f);
  const [lastImport] = await db.select().from(s.integrationConfigs).where(eq(s.integrationConfigs.key, "website"));
  const li = (lastImport?.settings as { lastImport?: { at: string; created: number; updated: number } } | undefined)?.lastImport;
  const manage = can(u, "nannies.manage");
  return (
    <>
      <PageHeader eyebrow="Network" title="Nannies" description="Prepare profiles before nannies have a login, invite them to claim their account, then verify, approve and publish." />
      <nav aria-label="Filter by stage" className="mb-4 flex gap-1 overflow-x-auto rounded-[12px] bg-sand p-1">
        {FILTERS.map(([k, l]) => <Link key={k} href={`?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={f === k ? "page" : undefined} className={`whitespace-nowrap rounded-[9px] px-3 py-2 text-[13px] font-medium ${f === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{l} <span className="text-subtle">{counts[k]}</span></Link>)}
      </nav>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <form className="flex max-w-md gap-2" role="search"><input type="hidden" name="f" value={f} /><label htmlFor="q" className="sr-only">Search nannies</label><input id="q" name="q" defaultValue={q} placeholder="Search by name" className="input" /><button className="btn-secondary">Search</button></form>
          {list.length ? (
            <ActionForm action={bulkInviteAction} className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="tbl min-w-[760px]">
                  <thead><tr>{manage && <th className="w-10"><span className="sr-only">Select</span></th>}<th>Nanny</th><th>Stage</th><th>Next step</th><th>Source</th><th className="text-right">Active</th></tr></thead>
                  <tbody>{list.map(({ n, stage, upcoming, changes, pendingDocs }) => (
                    <tr key={n.id}>
                      {manage && <td><input type="checkbox" name="ids" value={n.id} aria-label={`Select ${n.displayName}`} disabled={!!n.userId} className="h-4 w-4 accent-navy" /></td>}
                      <td><Link href={`/manage/nannies/${n.id}`} className="flex items-center gap-3"><Avatar name={n.displayName} src={n.photoKey ? `/api/photos/${n.id}` : null} size={36} /><span><span className="font-semibold text-ink hover:underline">{n.displayName}</span><span className="block text-[12px] text-muted">{n.contactEmail ?? (n.userId ? "Account claimed" : "No email yet")}</span></span></Link></td>
                      <td><Badge tone={stage.tone}>{stage.label}</Badge>{(pendingDocs > 0 || changes > 0) && <span className="mt-1 block text-[12px] text-gold-600">{pendingDocs} docs · {changes} changes to review</span>}</td>
                      <td className="max-w-[280px] text-[13px] text-muted">{stage.next}</td>
                      <td className="text-[13px] capitalize text-muted">{n.importSource ?? "Manual"}</td>
                      <td className="text-right">{upcoming}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {manage && <div className="flex items-center justify-between gap-3 border-t border-line bg-cream px-4 py-3"><p className="text-[13px] text-muted">Select unclaimed profiles with an email address to invite them together.</p><Submit className="btn-secondary btn-sm" pendingText="Inviting…">Send invitations</Submit></div>}
            </ActionForm>
          ) : <Empty title="No nannies in this view">Change the filter, import the website profiles, or create a profile.</Empty>}
        </div>
        {manage && (
          <div className="space-y-6">
            <Section title="Create a profile" description="No email needed yet — you can invite later.">
              <ActionForm action={createNannyAction} className="space-y-3">
                <div><label className="label" htmlFor="displayName">Display name</label><input id="displayName" name="displayName" required placeholder="First name + initial" className="input" /></div>
                <div><label className="label" htmlFor="email">Email (optional)</label><input id="email" name="email" type="email" className="input" /></div>
                <div><label className="label" htmlFor="phone">Phone (optional)</label><input id="phone" name="phone" type="tel" className="input" /></div>
                <Submit>Create draft profile</Submit>
              </ActionForm>
            </Section>
            <Section title="Import from omeganannies.com" description="Creates or refreshes unpublished drafts. Edited or verified fields are never overwritten.">
              <ActionForm action={importWebsiteAction}><Submit className="btn-secondary w-full" pendingText="Importing…">Run website import</Submit></ActionForm>
              {li && <p className="mt-3 text-[12px] text-muted">Last run {fmtDateTime(new Date(li.at))}: {li.created} new, {li.updated} updated.</p>}
            </Section>
            <Section title="Bulk import (CSV)" description="Columns: name, email, phone, headline, bio, years, languages, areas, services (lists separated by ;).">
              <ActionForm action={csvImportAction} className="space-y-3" resetOnSuccess>
                <input name="file" type="file" accept=".csv,text/csv" required aria-label="CSV file" className="input" />
                <Submit className="btn-secondary w-full" pendingText="Importing…">Import CSV</Submit>
              </ActionForm>
            </Section>
          </div>
        )}
      </div>
    </>
  );
}
