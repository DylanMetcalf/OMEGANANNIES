import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { bookingAccess } from "@/lib/bookings";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Printable receipt for a verified payment (print to PDF from the browser). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorised", { status: 401 });
  const [p] = await db.select().from(s.payments).where(eq(s.payments.id, (await params).id));
  if (!p || p.status !== "succeeded") return new Response("Not found", { status: 404 });
  const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.id, p.invoiceId));
  const [b] = await db.select().from(s.bookings).where(eq(s.bookings.id, inv.bookingId));
  const acc = await bookingAccess(u, b);
  if (acc.level !== "family" && acc.level !== "management") return new Response("Not found", { status: 404 });
  const [f] = b.familyId ? await db.select().from(s.families).where(eq(s.families.id, b.familyId)) : [];
  const html = `<!doctype html><meta charset="utf-8"><title>Receipt ${esc(inv.number)}</title><body style="font-family:Georgia,serif;color:#2c3347;max-width:640px;margin:40px auto;padding:0 20px">
  <h1 style="color:#1a2340;letter-spacing:.05em">OMEGA NANNIES</h1><hr style="border:none;border-top:2px solid #c8922a;width:60px;margin-left:0">
  <h2>Payment receipt</h2><p>Received with thanks from <strong>${esc(f?.billingName ?? f?.displayName ?? "")}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
  ${[["Receipt", p.id.slice(0, 8).toUpperCase()], ["Invoice", inv.number], ["Booking", b.reference], ["Date", fmtDateTime(p.confirmedAt ?? p.createdAt)], ["Method", p.provider === "manual" ? "EFT" : p.provider], ["Amount", formatMoney(p.amountMinor, p.currency)]].map(([k, v]) => `<tr><td style="padding:8px;border-bottom:1px solid #ede5d8;color:#5d6472">${k}</td><td style="padding:8px;border-bottom:1px solid #ede5d8">${esc(String(v))}</td></tr>`).join("")}
  </table><p style="font-size:12px;color:#5d6472;margin-top:32px">Omega Nannies · Cape Town · enquiries@omeganannies.com${b.isDemo ? " · DEMO — not a valid tax document" : ""}</p><script>window.print&&0</script></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}
