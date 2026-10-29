import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "./audit";
import { putObject, sniffMime } from "./storage";

/**
 * Repeatable import of public nanny profiles from omeganannies.com/our-nannies.
 * - Reads the structured `data-nanny` JSON the public site embeds (no private pages, no auth bypass).
 * - Upserts by (import_source='website', source_ref=slug): never duplicates.
 * - Never overwrites a field whose provenance is no longer "website" (edited by Omega or the nanny) or is verified.
 * - Creates DRAFT, UNPUBLISHED profiles with no verification records: website claims are not verification.
 */
export const WEBSITE_BASE = process.env.WEBSITE_URL ?? "https://omeganannies.com";
export type WebsiteNanny = { name: string; photo?: string; quote?: string; bio?: string; experience?: string; languages?: string; license?: string; swimmer?: string; ageGroups?: string };

const decode = (x: string) => x.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export function parseNannies(html: string): WebsiteNanny[] {
  const out: WebsiteNanny[] = [];
  for (const m of html.matchAll(/data-nanny='([^']+)'/g)) {
    try { const j = JSON.parse(decode(m[1])); if (j && typeof j.name === "string" && j.name.trim()) out.push(j); } catch { /* skip malformed card */ }
  }
  return out;
}
const AGE_ORDER = ["newborn", "toddler", "preschool", "school", "teen"] as const;
const AGE_WORDS: [RegExp, (typeof AGE_ORDER)[number]][] = [[/newborn|bab(y|ies)|infant/i, "newborn"], [/toddler/i, "toddler"], [/pre-?school/i, "preschool"], [/school/i, "school"], [/teen/i, "teen"]];
/** "Toddlers – School-age" → toddler, preschool, school (ranges are inclusive). */
export function mapAgeGroups(text = ""): string[] {
  const found = text.split(/[,;]/).flatMap((part) => {
    const ends = part.split(/–|—|-(?=\s)|\bto\b/).map((p) => { const w = p.replace(/pre-?school/i, "preschool"); return AGE_WORDS.find(([re]) => re.test(w))?.[1]; }).filter(Boolean) as string[];
    if (ends.length >= 2) { const a = AGE_ORDER.indexOf(ends[0] as never), b = AGE_ORDER.indexOf(ends[ends.length - 1] as never); return AGE_ORDER.slice(Math.min(a, b), Math.max(a, b) + 1); }
    return ends;
  });
  return [...new Set(found)];
}
export const yearsFrom = (x = "") => Math.min(60, Number(/(\d+)/.exec(x)?.[1] ?? 0));
export const slugFor = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function mapNanny(w: WebsiteNanny) {
  const yes = (v?: string) => /^y/i.test(v ?? "");
  return {
    displayName: w.name.trim().slice(0, 80),
    headline: w.quote?.trim().slice(0, 140) || null,
    bio: w.bio?.trim().slice(0, 3000) || null,
    yearsExperience: yearsFrom(w.experience),
    languages: (w.languages ?? "").split(/[,/&]| and /).map((x) => x.trim()).filter(Boolean),
    canDrive: yes(w.license),
    skills: yes(w.swimmer) ? ["Swimming supervision"] : [],
    ageGroups: mapAgeGroups(w.ageGroups),
  };
}
type Mapped = ReturnType<typeof mapNanny>;
const FIELDS = ["displayName", "headline", "bio", "yearsExperience", "languages", "canDrive", "skills", "ageGroups", "photo"] as const;

export type ImportReport = { found: number; created: number; updated: number; unchanged: number; photos: number; skippedFields: number; errors: string[] };

export async function importWebsiteNannies(actorId: string | null, opts: { fetchImpl?: typeof fetch; html?: string; isDemo?: boolean } = {}): Promise<ImportReport> {
  const f = opts.fetchImpl ?? fetch;
  const html = opts.html ?? (await (await f(`${WEBSITE_BASE}/our-nannies`, { signal: AbortSignal.timeout(15000) })).text());
  const list = parseNannies(html);
  const r: ImportReport = { found: list.length, created: 0, updated: 0, unchanged: 0, photos: 0, skippedFields: 0, errors: [] };
  const now = new Date();
  for (const w of list) {
    const ref = slugFor(w.name);
    try {
      const m = mapNanny(w);
      const [existing] = await db.select().from(s.nannies).where(and(eq(s.nannies.importSource, "website"), eq(s.nannies.sourceRef, ref)));
      let photoKey: string | null = null;
      if (w.photo && /^\/storage\/images\/[\w.-]+\.(jpe?g|png|webp)$/i.test(w.photo) && (!existing || !existing.photoKey)) {
        try {
          const res = await f(`${WEBSITE_BASE}${w.photo}`, { signal: AbortSignal.timeout(15000) });
          const buf = Buffer.from(await res.arrayBuffer());
          if (res.ok && buf.length < 8 * 1024 * 1024 && sniffMime(buf)) { photoKey = (await putObject(buf, sniffMime(buf)!)).key; r.photos++; }
        } catch (e) { r.errors.push(`${w.name}: photo ${(e as Error).message}`); }
      }
      const prov = { source: "website", verified: false, at: now.toISOString(), by: actorId };
      if (!existing) {
        const provenance = Object.fromEntries(FIELDS.filter((k) => k !== "photo" || photoKey).map((k) => [k, prov]));
        const [n] = await db.insert(s.nannies).values({
          ...m, slug: `${ref}-${Math.random().toString(36).slice(2, 6)}`, status: "draft", published: false, services: [], areas: [],
          photoKey, importSource: "website", sourceRef: ref, sourceUrl: `${WEBSITE_BASE}/our-nannies`, importedAt: now, provenance, isDemo: !!opts.isDemo,
          internalNotes: "Imported from the public website. Details are unverified until reviewed.",
        }).returning();
        if (photoKey) await db.update(s.nannies).set({ photoUrl: `/api/photos/${n.id}` }).where(eq(s.nannies.id, n.id));
        await audit(actorId, "import.website.create", "nanny", n.id, { ref });
        r.created++;
        continue;
      }
      // Update only fields still owned by the website import and not yet verified.
      const p = existing.provenance as Record<string, { source: string; verified?: boolean }>;
      const patch: Partial<Mapped> & { photoKey?: string; photoUrl?: string } = {};
      const provenance = { ...p };
      for (const k of FIELDS) {
        const owned = !p[k] || (p[k].source === "website" && !p[k].verified);
        if (k === "photo") { if (photoKey && owned) { patch.photoKey = photoKey; patch.photoUrl = `/api/photos/${existing.id}`; provenance.photo = prov; } else if (photoKey) r.skippedFields++; continue; }
        const next = m[k as keyof Mapped], cur = existing[k as keyof typeof existing];
        if (JSON.stringify(next) === JSON.stringify(cur)) continue;
        if (!owned) { r.skippedFields++; continue; }
        (patch as Record<string, unknown>)[k] = next; provenance[k] = prov;
      }
      if (Object.keys(patch).length) {
        await db.update(s.nannies).set({ ...patch, provenance, importedAt: now, updatedAt: now }).where(eq(s.nannies.id, existing.id));
        await audit(actorId, "import.website.update", "nanny", existing.id, { fields: Object.keys(patch) });
        r.updated++;
      } else r.unchanged++;
    } catch (e) { r.errors.push(`${w.name}: ${(e as Error).message}`); }
  }
  await db.insert(s.integrationConfigs).values({ key: "website", enabled: true, lastSuccessAt: now, settings: { lastImport: { ...r, at: now.toISOString() } } })
    .onConflictDoUpdate({ target: s.integrationConfigs.key, set: { lastSuccessAt: now, settings: { lastImport: { ...r, at: now.toISOString() } } } });
  await audit(actorId, "import.website.run", "integration", "website", r);
  return r;
}

/** CSV bulk import for profiles prepared offline. Columns: name,email,phone,headline,bio,years,languages,areas,services. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
