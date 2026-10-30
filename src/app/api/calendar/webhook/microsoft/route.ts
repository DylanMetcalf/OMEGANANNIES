import { connectionForWebhook, syncIncoming } from "@/lib/calendar/sync";

/** Microsoft Graph change notifications: validation handshake, then clientState verified per subscription. */
export async function POST(req: Request) {
  const v = new URL(req.url).searchParams.get("validationToken");
  if (v) return new Response(v.slice(0, 2000), { status: 200, headers: { "Content-Type": "text/plain" } });
  const body = (await req.json().catch(() => null)) as { value?: { subscriptionId?: string; clientState?: string }[] } | null;
  let ok = 0;
  for (const n of body?.value?.slice(0, 50) ?? []) {
    const c = await connectionForWebhook("microsoft", n.subscriptionId ?? null, n.clientState ?? null);
    if (!c) continue;
    ok++;
    await syncIncoming(c.id).catch(() => undefined);
  }
  return new Response(null, { status: ok ? 202 : 401 });
}
