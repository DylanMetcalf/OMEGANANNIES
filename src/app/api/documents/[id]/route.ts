import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { nannyOf } from "@/lib/bookings";
import { can } from "@/lib/permissions";
import { getObject, verifyDocumentSig } from "@/lib/storage";

/** Private document download: requires a valid short-lived signature AND a fresh authorisation check. Audited. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Unauthorised", { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  if (!verifyDocumentSig(id, u.id, url.searchParams.get("exp"), url.searchParams.get("sig"))) return new Response("Link expired", { status: 403 });
  const [d] = await db.select().from(s.documents).where(eq(s.documents.id, id));
  if (!d) return new Response("Not found", { status: 404 });
  const own = d.ownerNannyId && (await nannyOf(u.id))?.id === d.ownerNannyId;
  if (!own && !can(u, "vetting.manage")) return new Response("Not found", { status: 404 });
  await audit(u.id, "document.view", "document", d.id, { docType: d.docType });
  return new Response(new Uint8Array(await getObject(d.storageKey)), { headers: { "Content-Type": d.mimeType, "Content-Disposition": `inline; filename="${d.fileName.replace(/[^\w.-]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
