import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { hmac, randomToken, safeEqual, sha256 } from "./crypto";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAGIC: [string, number[]][] = [["application/pdf", [0x25, 0x50, 0x44, 0x46]], ["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]], ["image/webp", [0x52, 0x49, 0x46, 0x46]]];

/** Detect type from content, not the client-declared MIME type or extension. */
export function sniffMime(buf: Buffer): string | null {
  for (const [mime, sig] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return mime === "image/webp" && buf.subarray(8, 12).toString() !== "WEBP" ? null : mime;
  return null;
}

const root = path.resolve(process.cwd(), "storage");
export async function putObject(buf: Buffer, mime: string): Promise<{ key: string; sha256: string }> {
  const key = `${new Date().toISOString().slice(0, 7)}/${randomToken(18)}`;
  if (env.storageDriver === "supabase") {
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${process.env.SUPABASE_BUCKET}/${key}`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": mime, "x-upsert": "false" }, body: new Uint8Array(buf),
    });
    if (!r.ok) throw new Error(`Storage upload failed (${r.status})`);
  } else {
    await mkdir(path.join(root, path.dirname(key)), { recursive: true });
    await writeFile(path.join(root, key), buf, { mode: 0o600 });
  }
  return { key, sha256: sha256(buf) };
}
export async function getObject(key: string): Promise<Buffer> {
  if (!/^[\w-]+\/[\w-]+$/.test(key)) throw new Error("Bad key");
  if (env.storageDriver === "supabase") {
    const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${process.env.SUPABASE_BUCKET}/${key}`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (!r.ok) throw new Error(`Storage read failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  return readFile(path.join(root, key));
}

/** Short-lived signed link bound to a document and a user; the download route re-checks authorisation too. */
export function signDocumentUrl(docId: string, userId: string, ttlSec = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/api/documents/${docId}?exp=${exp}&sig=${hmac(`${docId}.${userId}.${exp}`)}`;
}
export function verifyDocumentSig(docId: string, userId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`${docId}.${userId}.${exp}`), sig);
}
