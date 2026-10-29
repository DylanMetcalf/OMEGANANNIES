import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { demoProviderAction } from "../../actions";

export const metadata = { title: "Demo payment" };
export default async function DemoCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (!env.demo) notFound();
  const u = await requireUser({ role: "family" });
  const [p] = await db.select().from(s.payments).where(and(eq(s.payments.id, (await params).id), eq(s.payments.initiatedBy, u.id), eq(s.payments.provider, "demo")));
  if (!p) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef1f5] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-[#7a8699]">Simulated payment provider</p>
        <p className="mt-6 text-[14px] text-muted">Pay Omega Nannies</p>
        <p className="text-[36px] font-semibold text-[#1f2a3d]">{formatMoney(p.amountMinor, p.currency)}</p>
        <div className="mt-6 rounded-lg border border-dashed border-[#c5ccd6] p-3 text-[12px] text-[#5b6577]">Demo checkout. No card is requested and no money moves. Choosing an outcome sends a simulated server notification.</div>
        <form action={demoProviderAction} className="mt-6 grid gap-2">
          <input type="hidden" name="paymentId" value={p.id} />
          <button name="outcome" value="success" className="btn w-full bg-[#1f7a4d] text-white hover:bg-[#186640]">Simulate successful payment</button>
          <button name="outcome" value="fail" className="btn w-full border border-[#c5ccd6] text-[#5b6577]">Simulate declined card</button>
        </form>
      </div>
    </main>
  );
}
