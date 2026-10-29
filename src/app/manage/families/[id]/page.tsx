import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { dates } from "@/components/booking/parts";
import { DefList, PageHeader, Section, StatusBadge } from "@/components/ui";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { ageFrom, fmtDateTime } from "@/lib/time";
import { familyAdminAction, userStatusAction } from "../../actions";

export const metadata = { title: "Family record" };
export default async function FamilyRecord({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser({ perm: "families.view" });
  const { id } = await params;
  const [f] = await db.select().from(s.families).where(eq(s.families.id, id));
  if (!f) notFound();
  const sensitive = can(u, "sensitive.view");
  if (sensitive) await audit(u.id, "family.view_sensitive", "family", id);
  const [members, kids, locs, bookings] = await Promise.all([
    db.select({ m: s.familyMembers, u: s.users }).from(s.familyMembers).innerJoin(s.users, eq(s.users.id, s.familyMembers.userId)).where(eq(s.familyMembers.familyId, id)),
    db.select().from(s.children).where(eq(s.children.familyId, id)), db.select().from(s.serviceLocations).where(eq(s.serviceLocations.familyId, id)),
    db.select().from(s.bookings).where(eq(s.bookings.familyId, id)).orderBy(desc(s.bookings.startDate)),
  ]);
  const invoices = bookings.length ? await db.select().from(s.invoices).where(inArray(s.invoices.bookingId, bookings.map((b) => b.id))) : [];
  const support = members.length ? await db.select().from(s.supportRequests).where(inArray(s.supportRequests.userId, members.map((m) => m.u.id))).orderBy(desc(s.supportRequests.createdAt)) : [];
  return (
    <>
      <PageHeader eyebrow="Family record" title={f.displayName} actions={<Link href="/manage/families" className="btn-ghost">All families</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section title="Household"><DefList items={[["Type", f.audience], ["Country", f.countryOfResidence], ["Language", f.preferredLanguage], ["Contact via", f.preferredChannel], ["Billing", `${f.billingName ?? ""} ${f.billingEmail ?? ""}`], ["Emergency", `${f.emergencyContactName ?? ""} ${f.emergencyContactPhone ?? ""}`], ["Preferences", f.bookingPreferences]]} /></Section>
          <Section title="Children">{kids.length ? <ul className="grid gap-3 sm:grid-cols-2">{kids.map((c) => <li key={c.id} className="rounded-xl border border-line p-3 text-[14px]"><p className="font-medium text-navy">{c.preferredName} · {ageFrom(c.dateOfBirth) ?? "?"} yrs</p>{sensitive ? <>{c.allergies && <p className="text-bad">Allergies: {c.allergies}</p>}{c.dietaryNeeds && <p>Diet: {c.dietaryNeeds}</p>}{c.additionalNeeds && <p>Needs: {c.additionalNeeds}</p>}</> : <p className="text-muted">Sensitive details hidden.</p>}</li>)}</ul> : <p className="text-[14px] text-muted">No children recorded.</p>}</Section>
          <Section title="Bookings">{bookings.length ? <ul className="divide-y divide-line">{bookings.map((b) => <li key={b.id} className="flex justify-between py-2 text-[14px]"><Link className="link" href={`/manage/bookings/${b.id}`}>{b.reference} · {dates(b)}</Link><StatusBadge status={b.status} /></li>)}</ul> : <p className="text-[14px] text-muted">No bookings.</p>}</Section>
          <Section title="Invoices">{invoices.length ? <ul className="space-y-1 text-[14px]">{invoices.map((i) => <li key={i.id} className="flex justify-between"><span className="font-mono text-[13px]">{i.number}</span><span>{formatMoney(i.amountMinor)} · <span className={i.status === "paid" ? "text-ok" : "text-warn"}>{i.status}</span></span></li>)}</ul> : <p className="text-[14px] text-muted">None.</p>}</Section>
        </div>
        <div className="space-y-6">
          <Section title="Authorised contacts">{members.map(({ m, u: mu }) => <div key={mu.id} className="mb-3 flex items-center justify-between gap-2 text-[14px]"><div><p className="font-medium text-navy">{mu.name}{m.isPrimary && " (primary)"}</p><p className="text-[12px] text-muted">{mu.email} · {mu.status} · last login {mu.lastLoginAt ? fmtDateTime(mu.lastLoginAt) : "never"}</p></div>{can(u, "users.manage") && <ActionForm action={userStatusAction} confirm="Change this account's status?"><input type="hidden" name="userId" value={mu.id} /><Submit name="status" value={mu.status === "suspended" ? "active" : "suspended"} className="btn-ghost btn-sm">{mu.status === "suspended" ? "Reactivate" : "Suspend"}</Submit></ActionForm>}</div>)}</Section>
          <Section title="Locations">{locs.map((l) => <p key={l.id} className="text-[14px]"><strong>{l.label}</strong> · {l.area}<span className="block text-[12px] text-muted">{l.addressLine}</span></p>)}</Section>
          {can(u, "families.manage") && <Section title="Account controls"><ActionForm action={familyAdminAction} className="space-y-3"><input type="hidden" name="familyId" value={f.id} />
            <div><label className="label" htmlFor="aud">Pricing audience</label><select id="aud" name="audience" defaultValue={f.audience} className="input"><option value="visiting">Visiting / international</option><option value="resident">SA resident (bespoke)</option></select></div>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="restricted" defaultChecked={f.restricted} className="accent-navy" />Restrict new bookings</label>
            <div><label className="label" htmlFor="notes">Internal notes</label><textarea id="notes" name="internalNotes" rows={3} defaultValue={f.internalNotes ?? ""} className="input" /></div><Submit>Save</Submit></ActionForm></Section>}
          <Section title="Support history">{support.length ? <ul className="space-y-2 text-[14px]">{support.map((r) => <li key={r.id}>{r.subject} <span className="text-[12px] text-muted">· {r.status} · {fmtDateTime(r.createdAt)}</span></li>)}</ul> : <p className="text-[14px] text-muted">None.</p>}</Section>
        </div>
      </div>
    </>
  );
}
