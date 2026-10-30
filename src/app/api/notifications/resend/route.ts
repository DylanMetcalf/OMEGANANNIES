import { applyDeliveryStatus } from "@/lib/notify";
import { verifySvix } from "@/lib/webhook-signatures";

/** Resend delivery webhooks (Svix-signed): delivered → delivered; bounced/failed → failed. */
export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifySvix(process.env.RESEND_WEBHOOK_SECRET ?? "", { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!ok) return new Response("Unauthorised", { status: 401 });
  const e = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  const id = e.data?.email_id;
  if (id && e.type === "email.delivered") await applyDeliveryStatus(id, "delivered");
  else if (id && (e.type === "email.bounced" || e.type === "email.failed")) await applyDeliveryStatus(id, "failed", e.type);
  return new Response(null, { status: 204 });
}
