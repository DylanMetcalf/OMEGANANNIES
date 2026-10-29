"use server";
import { db, schema as s } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { ask, type AssistantAnswer } from "@/lib/assistant";
import { clientIp } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function askAction(_: { q: string; a: AssistantAnswer | null; error?: string } | null, fd: FormData) {
  const q = String(fd.get("q") ?? "").trim().slice(0, 1000);
  if (q.length < 4) return { q, a: null, error: "Ask a full question." };
  const u = await getCurrentUser();
  if (!(await rateLimit(`ai:${u?.id ?? await clientIp()}`, 15, 3600))) return { q, a: null, error: "You've asked a lot of questions — please message our team." };
  const audiences = ["public", ...(u?.roles.includes("family") ? ["family"] : []), ...(u?.roles.includes("nanny") ? ["nanny"] : [])];
  const a = await ask(q, audiences);
  if (!a) return { q, a: null, error: "The assistant is unavailable right now — the articles below may help, or message our team." };
  if (a.escalate) await db.insert(s.supportRequests).values({ userId: u?.id ?? null, subject: "Assistant could not answer", body: q, category: "assistant_escalation" });
  return { q, a };
}
