import { connectionForWebhook, syncIncoming } from "@/lib/calendar/sync";

/** Google push notification: verified with the per-channel secret token we registered (X-Goog-Channel-Token). */
export async function POST(req: Request) {
  const c = await connectionForWebhook("google", req.headers.get("x-goog-channel-id"), req.headers.get("x-goog-channel-token"));
  if (!c) return new Response("Unauthorised", { status: 401 });
  if (req.headers.get("x-goog-resource-state") !== "sync") await syncIncoming(c.id).catch(() => undefined); // failures are recorded and retried
  return new Response(null, { status: 200 });
}
