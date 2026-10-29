"use server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema as s } from "@/db";
import { assertUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { str } from "@/lib/forms";
import { deliverPending } from "@/lib/notify";
import { applyPaymentEvent } from "@/lib/payments/service";

/**
 * DEMO ONLY: simulates the provider's server-to-server notification. Disabled unless DEMO_MODE=true.
 * The booking still confirms only through applyPaymentEvent — never through a browser redirect.
 */
export async function demoProviderAction(fd: FormData) {
  if (!env.demo) throw new Error("Demo payments are disabled");
  const u = await assertUser({ role: "family" });
  const id = str(fd, "paymentId");
  const outcome = str(fd, "outcome") === "fail" ? "failed" : "succeeded";
  const [p] = await db.select().from(s.payments).where(and(eq(s.payments.id, id), eq(s.payments.initiatedBy, u.id), eq(s.payments.provider, "demo")));
  if (!p) throw new Error("Payment not found");
  await applyPaymentEvent({ provider: "demo", eventId: `demo:${p.id}:${outcome}`, paymentId: p.id, status: outcome, amountMinor: p.amountMinor, payload: { simulated: true, outcome } });
  void deliverPending();
  redirect(`/pay/${p.id}?return=1`);
}
