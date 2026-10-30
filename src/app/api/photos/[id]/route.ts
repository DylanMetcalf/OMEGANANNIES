import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getObject, sniffMime } from "@/lib/storage";

const WIDTHS = [160, 480, 960];
/** Nanny profile photos: published profiles to signed-in users; unpublished only to management or the nanny. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Not found", { status: 404 });
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [n] = await db.select({ key: s.nannies.photoKey, userId: s.nannies.userId, status: s.nannies.status, published: s.nannies.published }).from(s.nannies).where(eq(s.nannies.id, id));
  if (!n?.key) return new Response("Not found", { status: 404 });
  const visible = (n.status === "approved" && n.published) || can(u, "nannies.view") || n.userId === u.id;
  if (!visible) return new Response("Not found", { status: 404 });
  const buf = await getObject(n.key);
  // Responsive sizes for cards and drawers: proportional resize (never stretched), WebP, metadata stripped.
  const w = Number(new URL(req.url).searchParams.get("w"));
  if (WIDTHS.includes(w)) {
    const out = await sharp(buf).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return new Response(new Uint8Array(out), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": sniffMime(buf) ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
