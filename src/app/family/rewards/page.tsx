import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Gift } from "lucide-react";
import { db, schema as s } from "@/db";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { env } from "@/lib/env";
import { balances, ensureReferralCode } from "@/lib/growth";
import { formatMoney } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { fmtDate } from "@/lib/time";

export const metadata = { title: "Rewards" };
const STATUS: Record<string, string> = { signed_up: "Joined", qualified: "Qualified", pending_approval: "Being reviewed", rewarded: "Rewarded", rejected: "Not eligible", expired: "Expired" };
/** Visible only once Omega switches a programme on. Referred families are never named here. */
export default async function Rewards() {
  const u = await requireUser({ role: "family" });
  const [referral, loyalty] = await Promise.all([getSetting("referral"), getSetting("loyalty")]);
  if (!referral.enabled && !loyalty.enabled) notFound();
  const [familyId] = await familyIdsOf(u.id);
  const code = referral.enabled ? await ensureReferralCode(familyId, u.id) : null;
  const [bal, refs, ledger] = await Promise.all([
    balances(familyId),
    code ? db.select({ status: s.referrals.status, createdAt: s.referrals.createdAt }).from(s.referrals).where(eq(s.referrals.codeId, code.id)).orderBy(desc(s.referrals.createdAt)) : [],
    db.select().from(s.loyaltyLedger).where(eq(s.loyaltyLedger.familyId, familyId)).orderBy(desc(s.loyaltyLedger.createdAt)).limit(50),
  ]);
  const link = code ? `${env.appUrl}/r/${code.code}` : "";
  return (
    <>
      <PageHeader eyebrow="Rewards" title="Thank you for spreading the word" description="Rewards follow Omega's programme terms and are added once a referral qualifies." />
      <div className="grid gap-6 lg:grid-cols-2">
        {code && (
          <Section title="Your referral link" description={referral.rewardValue ? `When a family you refer completes their first qualifying booking, you receive ${referral.rewardType === "points" ? `${referral.rewardValue} points` : formatMoney(referral.rewardValue)}.` : "Share Omega with friends."}>
            <p className="rounded-[10px] bg-cream px-3 py-2.5 font-mono text-[14px] break-all">{link}</p>
            <p className="mt-2 text-[13px] text-muted">Code: <strong className="font-mono">{code.code}</strong></p>
          </Section>
        )}
        <Section title="Your balance">
          <div className="flex gap-8">{loyalty.enabled && <div><p className="text-[12px] text-muted">Points</p><p className="font-display text-[28px] font-bold tabular-nums">{bal.points}</p></div>}<div><p className="text-[12px] text-muted">Credit</p><p className="font-display text-[28px] font-bold tabular-nums">{formatMoney(bal.creditMinor)}</p></div></div>
          <p className="mt-2 text-[12px] text-muted">Credit is applied by Omega to a future quotation on request.</p>
        </Section>
        {code && <Section title="Families you referred">{refs.length ? <ul className="divide-y divide-line text-[14px]">{refs.map((r, i) => <li key={i} className="flex justify-between py-2"><span>Referred family · {fmtDate(r.createdAt)}</span><span className="text-muted">{STATUS[r.status] ?? r.status}</span></li>)}</ul> : <Empty title="No referrals yet">Share your link — we&rsquo;ll show progress here without naming anyone.</Empty>}</Section>}
        <Section title="History">{ledger.length ? <ul className="divide-y divide-line text-[14px]">{ledger.map((l) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.note ?? l.reason} <span className="block text-[12px] text-muted">{fmtDate(l.createdAt)}</span></span><span className={`tabular-nums ${l.delta < 0 ? "text-bad" : "text-ok"}`}>{l.delta > 0 ? "+" : ""}{l.kind === "points" ? `${l.delta} pts` : formatMoney(l.delta)}</span></li>)}</ul> : <div className="flex items-center gap-3 text-[14px] text-muted"><Gift aria-hidden className="h-5 w-5" />Nothing yet.</div>}</Section>
      </div>
    </>
  );
}
