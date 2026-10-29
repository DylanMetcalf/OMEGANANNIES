import { createHmac } from "node:crypto";
import { db, schema as s } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Calendly webhook (invitee.created / invitee.canceled). Verifies Calendly-Webhook-Signature (t=…,v1=…).
 * Records the event for management review only: a calendar booking never confirms an Omega booking.
 */
export async function POST(req: Request) {
  if (!env.calendlySigningKey) return new Response("Calendly not configured", { status: 503 });
  const raw = await req.text();
  const header = req.headers.get("calendly-webhook-signature") ?? "";
  const t = /t=(\d+)/.exec(header)?.[1], v1 = /v1=([a-f0-9]+)/.exec(header)?.[1];
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return new Response("stale", { status: 400 });
  if (!safeEqual(createHmac("sha256", env.calendlySigningKey).update(`${t}.${raw}`).digest("hex"), v1)) return new Response("bad signature", { status: 401 });
  const body = JSON.parse(raw) as { event: string; payload?: { email?: string; name?: string; scheduled_event?: { start_time?: string; uri?: string } } };
  await db.insert(s.supportRequests).values({ subject: `Calendly ${body.event}: ${body.payload?.name ?? ""}`.slice(0, 140), body: `Invitee ${body.payload?.email ?? "?"} — ${body.payload?.scheduled_event?.start_time ?? ""}. Link to a booking introduction manually.`, category: "calendar" });
  await db.insert(s.integrationConfigs).values({ key: "calendly", enabled: true, lastSuccessAt: new Date() }).onConflictDoUpdate({ target: s.integrationConfigs.key, set: { lastSuccessAt: new Date() } });
  return new Response("ok");
}
