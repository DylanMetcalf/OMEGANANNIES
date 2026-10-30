import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { configProblems } from "@/lib/config-check";
import { can, PERMISSIONS } from "@/lib/permissions";
import { paymentProvider } from "@/lib/payments/service";
import { fmtDateTime } from "@/lib/time";
import { confirmMfaAction, inviteStaffAction, platformSettingsAction, retentionAction, staffAccessAction, startMfaAction } from "../actions";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Administration" };
export default async function Admin({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const u = await requireUser({ role: "management" });
  const entity = (await searchParams).entity;
  const staff = can(u, "users.manage") ? await db.select({ u: s.users, roles: sql<string[]>`array_agg(${s.userRoles.role})::text[]` }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).where(inArray(s.userRoles.role, ["ops", "manager", "admin"])).groupBy(s.users.id).orderBy(s.users.name) : [];
  const auditRows = can(u, "audit.view") ? await db.select({ a: s.auditEvents, who: s.users.name }).from(s.auditEvents).leftJoin(s.users, eq(s.users.id, s.auditEvents.actorId)).where(entity ? eq(s.auditEvents.entity, entity) : undefined).orderBy(desc(s.auditEvents.createdAt)).limit(60) : [];
  const integrations = await db.select().from(s.integrationConfigs);
  const [ret] = await db.select().from(s.settings).where(eq(s.settings.key, "retention"));
  const rv = (ret?.value ?? { messagesMonths: 24, closedAccountMonths: 12, financialYears: 5 }) as Record<string, number>;
  const [emailStats] = (await db.execute<{ pending: number; failed: number; sent: number; captured: number }>(sql`SELECT count(*) FILTER (WHERE status='pending')::int pending, count(*) FILTER (WHERE status='failed')::int failed, count(*) FILTER (WHERE status='sent')::int sent, count(*) FILTER (WHERE status='captured')::int captured FROM notifications WHERE channel='email'`)).rows;
  const [me] = await db.select().from(s.users).where(eq(s.users.id, u.id));
  const [reveal, requireAccept] = await Promise.all([getSetting("addressReveal"), getSetting("requireNannyAcceptance")]);
  const integ = [
    ["Payments (PayFast)", paymentProvider() === "payfast" ? (env.payfast.sandbox ? "Configured — sandbox" : "Configured — live") : env.demo ? "Demo provider (no real payments)" : "Not configured — needs merchant ID, key & passphrase", paymentProvider() === "payfast"],
    ["Email (Resend)", env.resendKey ? (env.demo ? "Key present — demo mode captures emails" : "Configured") : "Not configured — emails captured in outbox", !!env.resendKey && !env.demo],
    ["Website enquiries", env.websiteSecret ? "Signing secret configured" : "Not configured — set WEBSITE_WEBHOOK_SECRET", !!env.websiteSecret],
    ["Calendly", env.calendlySigningKey ? "Webhook signing key configured" : "Not configured (optional)", !!env.calendlySigningKey],
    ["AI assistant", env.anthropicKey ? `Configured (${env.anthropicModel})` : "Not configured — FAQ search only", !!env.anthropicKey],
    ["Document storage", env.storageDriver === "supabase" ? "Supabase private bucket" : "Local private disk (dev/demo only)", env.storageDriver === "supabase"],
  ] as const;
  const { warnings } = configProblems();
  return (
    <>
      <PageHeader eyebrow="Administration" title="System & access" />
      {warnings.length > 0 && <div className="mb-6"><Notice tone="warn" title="Before going live"><ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice></div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Integrations — actual status">
          <ul className="divide-y divide-line">{integ.map(([k, v, ok]) => { const row = integrations.find((i) => k.toLowerCase().includes(i.key)); return <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]"><span className="font-medium text-navy">{k}</span><span className="flex items-center gap-2 text-[13px]"><span className="text-muted">{v}</span><Badge tone={ok ? "ok" : "warn"}>{ok ? "ready" : "blocked"}</Badge>{row?.lastSuccessAt && <span className="text-[12px] text-muted">last ok {fmtDateTime(row.lastSuccessAt)}</span>}</span></li>; })}</ul>
          <p className="mt-3 text-[12px] text-muted">Email outbox: {emailStats.sent} sent · {emailStats.captured} captured · {emailStats.pending} pending · {emailStats.failed} failed (retried up to 5×). Secrets are managed in environment variables, never in the database.</p>
        </Section>
        <Section title="Your security">
          {me.mfaEnabled ? <p className="text-[14px]"><Badge tone="ok">Two-step verification on</Badge></p> : (
            <div className="space-y-3">
              <ActionForm action={startMfaAction}><Submit className="btn-secondary btn-sm">Set up two-step verification</Submit></ActionForm>
              <ActionForm action={confirmMfaAction} className="flex gap-2"><input name="code" inputMode="numeric" maxLength={6} placeholder="6-digit code" aria-label="Code" className="input !w-40" /><Submit className="btn-primary btn-sm">Confirm</Submit></ActionForm>
            </div>
          )}
        </Section>
        {can(u, "users.manage") && (
          <Section title="Team members & permissions" className="xl:col-span-2">
            <ActionForm action={inviteStaffAction} className="mb-5 flex flex-wrap gap-2" resetOnSuccess><input name="email" type="email" required placeholder="name@omeganannies.com" aria-label="Email" className="input !w-72" /><select name="role" aria-label="Role" className="input !w-40"><option value="ops">Operations</option><option value="manager">Manager</option><option value="admin">Administrator</option></select><Submit className="btn-primary">Invite</Submit></ActionForm>
            <div className="space-y-3">{staff.map(({ u: m, roles }) => (
              <details key={m.id} className="rounded-xl border border-line p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-[14px]"><span><span className="font-medium text-navy">{m.name}</span> <span className="text-muted">{m.email}</span></span><span className="flex gap-1.5">{roles.map((r) => <Badge key={r} tone="info">{r}</Badge>)}<Badge tone={m.status === "active" ? "ok" : "bad"}>{m.status}</Badge>{m.mfaEnabled && <Badge tone="ok">MFA</Badge>}</span></summary>
                <ActionForm action={staffAccessAction} className="mt-3 space-y-3"><input type="hidden" name="userId" value={m.id} />
                  <p className="text-[12px] text-muted">Role defaults always apply ({roles.join(", ")}). Tick extra permissions for operations staff.</p>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(PERMISSIONS).map(([k, v]) => <label key={k} className="flex items-start gap-2 text-[13px]"><input type="checkbox" name="permissions" value={k} defaultChecked={m.permissions.includes(k)} className="mt-0.5 accent-navy" /><span><span className="font-mono text-[11px]">{k}</span><span className="block text-muted">{v}</span></span></label>)}</div>
                  <div className="flex gap-2"><select name="status" defaultValue={m.status} aria-label="Status" className="input !w-40"><option value="active">Active</option><option value="suspended">Suspended</option></select><Submit className="btn-secondary">Save access</Submit></div>
                </ActionForm>
              </details>
            ))}</div>
          </Section>
        )}
        {can(u, "settings.manage") && (
          <Section title="Booking & privacy rules" description="Defaults until Omega confirms its policies.">
            <ActionForm action={platformSettingsAction} className="space-y-4">
              <div><label className="label" htmlFor="addressReveal">Share the family’s address and children’s care notes with the nanny from</label>
                <select id="addressReveal" name="addressReveal" defaultValue={reveal} className="input"><option value="confirmed">Booking confirmed (paid)</option><option value="in_progress">Care has started (nanny checked in)</option></select></div>
              <label className="flex items-start gap-2.5 text-[14px]"><input type="checkbox" name="requireNannyAcceptance" defaultChecked={requireAccept} className="mt-0.5 h-4 w-4 accent-navy" /><span>Require the nanny to accept an offer before a quotation can be sent</span></label>
              <Submit className="btn-secondary">Save rules</Submit>
            </ActionForm>
          </Section>
        )}
        {can(u, "settings.manage") && (
          <Section title="Data retention (POPIA)">
            <ActionForm action={retentionAction} className="grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="m">Messages (months)</label><input id="m" name="messagesMonths" type="number" defaultValue={rv.messagesMonths} className="input" /></div>
              <div><label className="label" htmlFor="c">Closed accounts (months)</label><input id="c" name="closedAccountMonths" type="number" defaultValue={rv.closedAccountMonths} className="input" /></div>
              <div><label className="label" htmlFor="f">Financial records (years)</label><input id="f" name="financialYears" type="number" defaultValue={rv.financialYears} className="input" /></div>
              <div className="sm:col-span-3"><Submit className="btn-secondary">Save</Submit><p className="mt-1 text-[12px] text-muted">Proposed defaults — confirm with Omega&rsquo;s legal adviser. Location data is deleted when sharing ends.</p></div>
            </ActionForm>
          </Section>
        )}
        {can(u, "audit.view") && (
          <Section title="Audit log" className="xl:col-span-2" action={<form className="flex gap-2"><select name="entity" defaultValue={entity ?? ""} aria-label="Entity" className="input !py-1 text-[13px]"><option value="">All</option>{["booking", "payment", "document", "nanny", "family", "user", "conversation", "price_book"].map((x) => <option key={x}>{x}</option>)}</select><button className="btn-ghost btn-sm">Filter</button></form>}>
            <div tabIndex={0} role="region" aria-label="Table — scroll sideways to see more" className="overflow-x-auto focus-visible:outline-2"><table className="tbl min-w-[720px]"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>{auditRows.map(({ a, who }) => <tr key={a.id}><td className="whitespace-nowrap text-[13px]">{fmtDateTime(a.createdAt)}</td><td className="text-[13px]">{who ?? "System"}</td><td className="font-mono text-[12px]">{a.action}</td><td className="text-[13px]">{a.entity} <span className="text-muted">{a.entityId?.slice(0, 8)}</span></td><td className="max-w-[280px] truncate font-mono text-[11px] text-muted">{a.detail ? JSON.stringify(a.detail) : ""}</td></tr>)}</tbody></table></div>
          </Section>
        )}
      </div>
    </>
  );
}
