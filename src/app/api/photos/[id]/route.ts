import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getObject, sniffMime } from "@/lib/storage";

/** Nanny profile photos: published profiles to signed-in users; unpublished only to management or the nanny. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Not found", { status: 404 });
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [n] = await db.select({ key: s.nannies.photoKey, userId: s.nannies.userId, status: s.nannies.status, published: s.nannies.published }).from(s.nannies).where(eq(s.nannies.id, id));
  if (!n?.key) return new Response("Not found", { status: 404 });
  const visible = (n.status === "approved" && n.published) || can(u, "nannies.view") || n.userId === u.id;
  if (!visible) return new Response("Not found", { status: 404 });
  const buf = await getObject(n.key);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": sniffMime(buf) ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
