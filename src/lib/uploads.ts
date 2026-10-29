import "server-only";
import net from "node:net";
import { DomainError } from "./bookings";
import { MAX_UPLOAD_BYTES, putObject, sniffMime } from "./storage";

const IMAGE_MAX = 5 * 1024 * 1024;

export type ScanResult = "clean" | "infected" | "error" | "not_scanned";

/**
 * Optional ClamAV scan via clamd INSTREAM (set CLAMAV_HOST / CLAMAV_PORT). Without it, files are stored as
 * "not_scanned" and staff are shown that status — a scan is never claimed when none ran.
 */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return "not_scanned";
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port: Number(process.env.CLAMAV_PORT ?? 3310) });
    let out = "";
    const done = (r: ScanResult) => { sock.destroy(); resolve(r); };
    sock.setTimeout(15000, () => done("error"));
    sock.on("error", () => done("error"));
    sock.on("data", (d) => { out += d.toString(); });
    sock.on("end", () => done(/OK\0?$/.test(out.trim()) ? "clean" : /FOUND/.test(out) ? "infected" : "error"));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(Buffer.concat([len, chunk]));
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/** Validates by content (magic bytes), not by extension or client MIME type. */
export async function storeDocumentUpload(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("Files must be 10 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) throw new DomainError("Upload a PDF, JPG, PNG or WebP file.");
  const scan = await scanBuffer(buf);
  if (scan === "infected") throw new DomainError("This file failed the malware scan and was not stored.");
  const { key, sha256 } = await putObject(buf, mime);
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
  return { key, sha256, mime, size: file.size, fileName: safeName, scan };
}

export async function storeImageUpload(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Choose an image.");
  if (file.size > IMAGE_MAX) throw new DomainError("Photos must be 5 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime || mime === "application/pdf") throw new DomainError("Upload a JPG, PNG or WebP photo.");
  if ((await scanBuffer(buf)) === "infected") throw new DomainError("This file failed the malware scan.");
  return putObject(buf, mime);
}
