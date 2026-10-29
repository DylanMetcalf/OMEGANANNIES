import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createNannyAction } from "../actions";

export const metadata = { title: "Nannies" };
export default async function Nannies() {
  const u = await requireUser({ perm: "nannies.view" });
  const rows = await db.select({
    n: s.nannies,
    passed: sql<number>`(SELECT count(DISTINCT kind)::int FROM verification_checks c WHERE c.nanny_id = ${s.nannies.id} AND c.status = 'passed' AND (c.expires_on IS NULL OR c.expires_on >= current_date))`,
    docs: sql<number>`(SELECT count(*)::int FROM documents d WHERE d.owner_nanny_id = ${s.nannies.id} AND d.status = 'pending_review')`,
    changes: sql<number>`(SELECT count(*)::int FROM profile_change_requests p WHERE p.nanny_id = ${s.nannies.id} AND p.status = 'pending')`,
    upcoming: sql<number>`(SELECT count(*)::int FROM bookings b WHERE b.nanny_id = ${s.nannies.id} AND b.status IN ('confirmed','in_progress'))`,
  }).from(s.nannies).orderBy(asc(s.nannies.displayName));
  const tone = (st: string) => (st === "approved" ? "ok" : st === "suspended" ? "bad" : "warn");
  return (
    <>
      <PageHeader eyebrow="Network" title="Nannies" description="Referral and invitation-only. Approval requires all five safeguarding checks to be current." />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead><tr><th>Nanny</th><th>Status</th><th>Vetting</th><th>To review</th><th>Active bookings</th></tr></thead>
            <tbody>{rows.map(({ n, passed, docs, changes, upcoming }) => (
              <tr key={n.id}>
                <td><Link href={`/manage/nannies/${n.id}`} className="flex items-center gap-3"><Avatar name={n.displayName} size={36} /><span><span className="font-medium text-navy">{n.displayName}</span><span className="block text-[12px] text-muted">{n.yearsExperience} yrs · {n.areas.slice(0, 2).join(", ")}</span></span></Link></td>
                <td><Badge tone={tone(n.status)}>{n.status}</Badge>{n.published && <span className="ml-1 text-[12px] text-muted">published</span>}</td>
                <td><span className={passed === 5 ? "text-ok" : "text-warn"}>{passed}/5 current</span></td>
                <td>{docs + changes > 0 ? <Badge tone="gold">{docs} docs · {changes} changes</Badge> : <span className="text-muted">—</span>}</td>
                <td>{upcoming}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {can(u, "nannies.manage") && (
          <Section title="Invite a nanny">
            <ActionForm action={createNannyAction} className="space-y-3">
              <div><label className="label" htmlFor="displayName">Display name</label><input id="displayName" name="displayName" required placeholder="First name + initial" className="input" /></div>
              <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" /></div>
              <Submit>Create &amp; invite</Submit>
              <p className="text-[12px] text-muted">The profile stays unpublished until vetting is complete and you approve it.</p>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
