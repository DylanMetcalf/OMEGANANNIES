import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { env } from "./env";

export type Article = typeof s.faqArticles.$inferSelect;

/** Keyword search across published articles the viewer may see. Works with no AI configured. */
export async function searchArticles(q: string, audiences: string[], limit = 8): Promise<Article[]> {
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2).slice(0, 8);
  const base = and(eq(s.faqArticles.published, true), inArray(s.faqArticles.audience, audiences));
  if (!words.length) return db.select().from(s.faqArticles).where(base).orderBy(s.faqArticles.category).limit(100);
  const rows = await db.select().from(s.faqArticles).where(and(base, or(...words.flatMap((w) => [ilike(s.faqArticles.title, `%${w}%`), ilike(s.faqArticles.body, `%${w}%`)]))));
  const score = (a: Article) => words.reduce((n, w) => n + (a.title.toLowerCase().includes(w) ? 3 : 0) + (a.body.toLowerCase().includes(w) ? 1 : 0), 0);
  return rows.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export type AssistantAnswer = { text: string; sources: { slug: string; title: string }[]; escalate: boolean };

const SYSTEM = `You are the Omega Nannies help assistant. Answer ONLY from the numbered articles provided in the user turn.
Rules:
- If the articles do not clearly answer the question, say you're not sure and suggest messaging the Omega team. Reply with the exact token [ESCALATE] at the end in that case.
- Never invent prices, availability, policies or nanny details. Never promise refunds, confirm bookings or make safeguarding decisions — those go to the team.
- Do not ask for or repeat personal or children's details.
- Cite the articles you used as [1], [2]. Keep answers under 150 words, warm and plain.`;

/**
 * Grounded answer over approved knowledge only. No account data is sent to the model;
 * account-specific questions are routed to the portal or the team.
 */
export async function ask(question: string, audiences: string[]): Promise<AssistantAnswer | null> {
  if (!env.anthropicKey) return null;
  const arts = (await searchArticles(question, audiences, 6)).filter((a) => a.aiApproved);
  if (!arts.length) return { text: "I couldn't find an approved answer to that. Please message the Omega team — we reply within 4 hours.", sources: [], escalate: true };
  const client = new Anthropic({ apiKey: env.anthropicKey, timeout: 30_000, maxRetries: 1 });
  const context = arts.map((a, i) => `[${i + 1}] ${a.title}\n${a.body}`).join("\n\n");
  try {
    const res = await client.beta.messages.create({
      model: env.anthropicModel,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Articles:\n${context}\n\nQuestion: ${question.slice(0, 1000)}` }],
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") return { text: "I can't help with that here. Please message the Omega team.", sources: [], escalate: true };
    let text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const escalate = text.includes("[ESCALATE]");
    text = text.replace("[ESCALATE]", "").trim();
    const used = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1))].filter((i) => arts[i]);
    await db.update(s.integrationConfigs).set({ lastSuccessAt: new Date() }).where(eq(s.integrationConfigs.key, "anthropic"));
    return { text, sources: used.map((i) => ({ slug: arts[i].slug, title: arts[i].title })), escalate };
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `API ${e.status}` : "network";
    await db.update(s.integrationConfigs).set({ lastErrorAt: new Date(), lastError: msg }).where(eq(s.integrationConfigs.key, "anthropic"));
    return null;
  }
}

