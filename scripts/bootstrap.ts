/**
 * Production-safe reference bootstrap: services, DRAFT price book (from the public rates page), public holidays,
 * website FAQ + help articles, integration registry. Idempotent. Optionally invites the first administrator:
 *   ADMIN_EMAIL=you@omeganannies.com npx tsx --conditions react-server scripts/bootstrap.ts
 */
import { eq, sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { db, pool, schema as s } from "../src/db";
import { randomToken, sha256 } from "../src/lib/crypto";
import { HELP_ARTICLES, PRICE_ITEMS_V1, PUBLIC_HOLIDAYS, SERVICES } from "../src/db/seed/reference";
import faq from "../src/db/seed/website-faq.json" with { type: "json" };

export async function bootstrapReference(opts: { publishPriceBook?: boolean } = {}) {
  await db.insert(s.serviceCategories).values(SERVICES).onConflictDoNothing();
  const [existing] = await db.select().from(s.priceBooks).where(eq(s.priceBooks.version, 1));
  if (!existing) {
    const [pb] = await db.insert(s.priceBooks).values({ version: 1, label: "Website rates (Oct 2026)", status: opts.publishPriceBook ? "published" : "draft", currency: "ZAR", effectiveFrom: opts.publishPriceBook ? new Date(Date.now() - 86400_000) : null, notes: "Imported from omeganannies.com/rates. Items marked TO CONFIRM are placeholders." }).returning();
    await db.insert(s.priceItems).values(PRICE_ITEMS_V1.map((i) => ({ ...i, priceBookId: pb.id })));
  }
  await db.insert(s.publicHolidays).values(PUBLIC_HOLIDAYS).onConflictDoNothing();
  const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
  const cat = (q: string) => /cost|pay|earn|price/i.test(q) ? "Pricing" : /police|first aid|vet/i.test(q) ? "Vetting" : /book|advance|meet/i.test(q) ? "Booking process" : "Services";
  await db.insert(s.faqArticles).values((faq as [string, string][]).map(([q, a]) => ({ slug: slug(q), title: q, body: a, category: cat(q), audience: "public", sourceUrl: "https://omeganannies.com/faq" }))).onConflictDoNothing();
  await db.insert(s.faqArticles).values(HELP_ARTICLES).onConflictDoNothing();
  await db.insert(s.integrationConfigs).values(["payfast", "resend", "calendly", "website", "anthropic", "storage"].map((key) => ({ key }))).onConflictDoNothing();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await bootstrapReference();
  const email = process.env.ADMIN_EMAIL;
  if (email) {
    const [{ c }] = (await db.execute(sql`SELECT count(*)::int AS c FROM user_roles WHERE role = 'admin'`)).rows as { c: number }[];
    if (c > 0) console.log("An administrator already exists; not issuing a bootstrap invite.");
    else {
      const token = randomToken();
      await db.insert(s.authTokens).values({ kind: "invite", tokenHash: sha256(token), email, role: "admin", expiresAt: new Date(Date.now() + 24 * 3600_000) });
      console.log(`Administrator invitation (valid 24h): ${process.env.APP_URL ?? ""}/invite?token=${token}`);
    }
  }
  console.log("Reference data bootstrapped.");
  await pool.end();
}
