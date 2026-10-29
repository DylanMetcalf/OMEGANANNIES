import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { Notice } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { payfastCheckout } from "@/lib/payments/service";

export const metadata = { title: "Payment" };
/** Payment hand-off and return page. Status shown here always comes from the database, never from the redirect. */
export default async function Pay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string; cancelled?: string }> }) {
  const u = await requireUser({ role: "family" });
  const { id } = await params;
  const sp = await searchParams;
  const [p] = await db.select().from(s.payments).where(and(eq(s.payments.id, id), eq(s.payments.initiatedBy, u.id)));
  if (!p) notFound();
  const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, p.invoiceId));
  const back = `/family/bookings/${inv.bookingId}`;
  if (!sp.return && !sp.cancelled && p.status === "initiated") {
    if (p.provider === "demo") redirect(`/pay/demo/${p.id}`);
    const co = await payfastCheckout(u, p.id);
    if (co) return (
      <main className="mx-auto max-w-md px-6 py-20 text-center">
        <Image src="/omega-logo.png" alt="Omega Nannies" width={150} height={50} className="mx-auto" />
        <h1 className="mt-8 text-[30px]">Continue to secure payment</h1>
        <p className="mt-2 text-muted">{formatMoney(p.amountMinor, p.currency)} for invoice {inv.number}. You&rsquo;ll be taken to PayFast.</p>
        <form action={co.action} method="post" className="mt-6">{co.fields.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<button className="btn-primary w-full">Pay {formatMoney(p.amountMinor)} with PayFast</button></form>
      </main>
    );
  }
  const waiting = p.status === "initiated" || p.status === "pending";
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      {waiting && !sp.cancelled && <AutoRefresh seconds={4} />}
      <Image src="/omega-logo.png" alt="Omega Nannies" width={150} height={50} className="mx-auto" />
      <h1 className="mt-8 text-[30px]">{p.status === "succeeded" ? "Payment received" : sp.cancelled ? "Payment cancelled" : waiting ? "Confirming your payment…" : "Payment not completed"}</h1>
      <div className="mt-4 text-left">
        {p.status === "succeeded" && <Notice tone="ok">We&rsquo;ve received {formatMoney(p.amountMinor, p.currency)}. Your booking status has been updated.</Notice>}
        {waiting && !sp.cancelled && <Notice tone="info">We&rsquo;re waiting for the payment provider to confirm. This page updates automatically — you can also close it; we&rsquo;ll email you.</Notice>}
        {(p.status === "failed" || sp.cancelled) && <Notice tone="warn">No money has been taken for this attempt. You can try again from your booking.</Notice>}
      </div>
      <Link href={back} className="btn-primary mt-6 w-full">Back to booking</Link>
    </main>
  );
}
