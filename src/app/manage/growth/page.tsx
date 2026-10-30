import { count, desc, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, Empty, Notice, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { services } from "@/lib/queries";
import { getSetting } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { adjustLedgerAction, decideReferralAction, loyaltySettingsAction, referralSettingsAction } from "../actions";

export const metadata = { title: "Referrals & loyalty" };
const FLAG: Record<string, string> = { same_email: "Same person?", many_signups_24h: "Many sign-ups in 24h", over_reward_limit: "Over reward limit" };
export default async function Growth() {
  const u = await requireUser({ role: "management" });
  if (!can(u, "reports.view") && !can(u, "settings.manage")) return <Empty title="You don't have access to this page" />;
  const [referral, loyalty, svc, stats, rows, ledger, families] = await Promise.all([
    getSetting("referral"), getSetting("loyalty"), services(),
    db.select({ status: s.referrals.status, n: count() }).from(s.referrals).groupBy(s.referrals.status),
    db.select({ r: s.referrals, code: s.referralCodes.code, referrer: s.families.displayName }).from(s.referrals).innerJoin(s.referralCodes, eq(s.referralCodes.id, s.referrals.codeId)).innerJoin(s.families, eq(s.families.id, s.referralCodes.familyId)).orderBy(desc(s.referrals.createdAt)).limit(50),
    db.select({ l: s.loyaltyLedger, fam: s.families.displayName }).from(s.loyaltyLedger).innerJoin(s.families, eq(s.families.id, s.loyaltyLedger.familyId)).orderBy(desc(s.loyaltyLedger.createdAt)).limit(30),
    db.select({ id: s.families.id, name: s.families.displayName }).from(s.families).orderBy(s.families.displayName).limit(500),
  ]);
  const n = (st: string) => stats.find((x) => x.status === st)?.n ?? 0;
  const [{ credit }] = await db.select({ credit: sql<number>`coalesce(sum(${s.loyaltyLedger.delta}) FILTER (WHERE ${s.loyaltyLedger.kind} = 'credit_minor'),0)::int` }).from(s.loyaltyLedger);
  const settings = can(u, "settings.manage"), money = can(u, "payments.manage");
  return (
    <>
      <PageHeader eyebrow="Growth" title="Referrals & loyalty" description="Built and ready, switched off until Omega approves terms. No reward is ever granted while a programme is off." actions={can(u, "reports.view") ? <a href="/api/reports/growth" className="btn-secondary">Export CSV</a> : undefined} />
      <div className="mb-6 flex flex-wrap gap-2"><Badge tone={referral.enabled ? "ok" : "neutral"}>Referrals {referral.enabled ? "active" : "off"}</Badge><Badge tone={loyalty.enabled ? "ok" : "neutral"}>Loyalty {loyalty.enabled ? "active" : "off"}</Badge></div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Referred sign-ups" value={stats.reduce((a, x) => a + x.n, 0)} />
        <Stat label="Awaiting approval" value={n("pending_approval")} />
        <Stat label="Rewarded" value={n("rewarded")} />
        <Stat label="Credit issued (net)" value={formatMoney(credit)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Referral programme terms">
          <ActionForm action={referralSettingsAction} className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={referral.enabled} disabled={!settings} className="h-4 w-4 accent-navy" />Programme active</label>
            <div><label className="label" htmlFor="rewardType">Reward type</label><select id="rewardType" name="rewardType" defaultValue={referral.rewardType} disabled={!settings} className="input"><option value="credit">Account credit (R)</option><option value="points">Loyalty points</option></select></div>
            <div><label className="label" htmlFor="rewardValue">Reward value</label><input id="rewardValue" name="rewardValue" defaultValue={referral.rewardType === "credit" ? (referral.rewardValue / 100).toFixed(2) : referral.rewardValue} disabled={!settings} inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="qualification">Qualifies when the referred family…</label><select id="qualification" name="qualification" defaultValue={referral.qualification} disabled={!settings} className="input"><option value="first_completed_booking">completes a first booking</option><option value="first_confirmed_booking">confirms a first booking</option></select></div>
            <div><label className="label" htmlFor="expiryDays">Must qualify within (days)</label><input id="expiryDays" name="expiryDays" type="number" min={1} defaultValue={referral.expiryDays} disabled={!settings} className="input" /></div>
            <div><label className="label" htmlFor="maxRewardsPerReferrer">Max rewards per referrer</label><input id="maxRewardsPerReferrer" name="maxRewardsPerReferrer" type="number" min={0} defaultValue={referral.maxRewardsPerReferrer} disabled={!settings} className="input" /></div>
            <fieldset className="sm:col-span-2"><legend className="label">Applies to services (none ticked = all)</legend><div className="flex flex-wrap gap-2">{svc.map((x) => <label key={x.code} className="chip"><input type="checkbox" name="services" value={x.code} defaultChecked={referral.services.includes(x.code)} disabled={!settings} className="sr-only" />{x.name}</label>)}</div></fieldset>
            <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="requireApproval" defaultChecked={referral.requireApproval} disabled={!settings} className="h-4 w-4 accent-navy" />Every reward needs management approval</label>
            {settings && <div className="sm:col-span-2"><Submit>Save referral terms</Submit></div>}
          </ActionForm>
        </Section>
        <Section title="Loyalty programme">
          <ActionForm action={loyaltySettingsAction} className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={loyalty.enabled} disabled={!settings} className="h-4 w-4 accent-navy" />Programme active</label>
            <div><label className="label" htmlFor="ppb">Points per completed booking</label><input id="ppb" name="pointsPerCompletedBooking" type="number" min={0} defaultValue={loyalty.pointsPerCompletedBooking} disabled={!settings} className="input" /></div>
            <div><label className="label" htmlFor="me">Milestone every N bookings</label><input id="me" name="milestoneEvery" type="number" min={0} defaultValue={loyalty.milestoneEvery} disabled={!settings} className="input" /></div>
            <div><label className="label" htmlFor="mp">Milestone bonus points</label><input id="mp" name="milestonePoints" type="number" min={0} defaultValue={loyalty.milestonePoints} disabled={!settings} className="input" /></div>
            {settings && <div className="sm:col-span-2"><Submit>Save loyalty rules</Submit></div>}
          </ActionForm>
          <div className="mt-4"><Notice tone="info">Points have no cash value until Omega defines how they are redeemed. Redemptions are recorded manually below.</Notice></div>
        </Section>
        <Section title="Referral activity" className="xl:col-span-2">
          {rows.length ? <div tabIndex={0} role="region" aria-label="Referrals" className="overflow-x-auto"><table className="tbl min-w-[640px]"><thead><tr><th>Referrer</th><th>Code</th><th>Joined</th><th>Status</th><th>Review</th><th /></tr></thead><tbody>
            {rows.map(({ r, code, referrer }) => <tr key={r.id}><td>{referrer}</td><td className="font-mono text-[13px]">{code}</td><td>{fmtDate(r.createdAt)}</td><td>{r.status.replace("_", " ")}</td><td>{r.flags.map((f) => <Badge key={f} tone="warn">{FLAG[f] ?? f}</Badge>)}</td>
              <td className="text-right">{money && r.status === "pending_approval" && <div className="flex justify-end gap-2"><ActionForm action={decideReferralAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><Submit className="btn-secondary btn-sm" pendingText="…">Approve</Submit></ActionForm><ActionForm action={decideReferralAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Submit className="btn-ghost btn-sm" pendingText="…">Reject</Submit></ActionForm></div>}</td></tr>)}
          </tbody></table></div> : <Empty title="No referrals yet">Referral links appear for families once the programme is active.</Empty>}
        </Section>
        <Section title="Ledger" description="Append-only. Every change is audited.">
          {ledger.length ? <ul className="divide-y divide-line text-[14px]">{ledger.map(({ l, fam }) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{fam} · {l.note ?? l.reason}<span className="block text-[12px] text-muted">{fmtDate(l.createdAt)}</span></span><span className="tabular-nums">{l.delta > 0 ? "+" : ""}{l.kind === "points" ? `${l.delta} pts` : formatMoney(l.delta)}</span></li>)}</ul> : <p className="text-[14px] text-muted">No entries.</p>}
        </Section>
        {money && <Section title="Manual adjustment or redemption">
          <ActionForm action={adjustLedgerAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <div className="sm:col-span-2"><label className="label" htmlFor="familyId">Family</label><select id="familyId" name="familyId" required className="input">{families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
            <div><label className="label" htmlFor="reason">Type</label><select id="reason" name="reason" className="input"><option value="adjustment">Adjustment</option><option value="redemption">Redemption</option></select></div>
            <div><label className="label" htmlFor="kind">Balance</label><select id="kind" name="kind" className="input"><option value="credit_minor">Credit (R)</option><option value="points">Points</option></select></div>
            <div><label className="label" htmlFor="amount">Amount (negative to deduct)</label><input id="amount" name="amount" required className="input" /></div>
            <div><label className="label" htmlFor="note">Reason (required)</label><input id="note" name="note" required minLength={5} className="input" /></div>
            <div className="sm:col-span-2"><Submit className="btn-secondary">Record</Submit></div>
          </ActionForm>
        </Section>}
      </div>
    </>
  );
}
