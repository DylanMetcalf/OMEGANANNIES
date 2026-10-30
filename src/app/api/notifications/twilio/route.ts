import { env } from "@/lib/env";
import { applyDeliveryStatus } from "@/lib/notify";
import { verifyTwilio } from "@/lib/webhook-signatures";

/** Twilio SMS/WhatsApp status callbacks. Signature-verified; only "delivered"/"read" counts as delivered. */
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  if (!verifyTwilio(process.env.TWILIO_AUTH_TOKEN ?? "", `${env.appUrl}/api/notifications/twilio`, params, req.headers.get("x-twilio-signature"))) return new Response("Unauthorised", { status: 401 });
  const sid = params.MessageSid, st = params.MessageStatus;
  if (sid && (st === "delivered" || st === "read")) await applyDeliveryStatus(sid, "delivered");
  else if (sid && (st === "failed" || st === "undelivered")) await applyDeliveryStatus(sid, "failed", `Twilio ${st}${params.ErrorCode ? ` (${params.ErrorCode})` : ""}`);
  return new Response(null, { status: 204 });
}
