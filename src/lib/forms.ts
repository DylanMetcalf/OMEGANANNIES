import { z } from "zod";
import type { ActionResult } from "@/components/action-form";
import { DomainError } from "./bookings";
import { AuthError } from "./auth";

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const opt = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const list = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

/** Converts zod / domain errors into user-facing results; anything else is logged and genericised. */
export async function run(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: "Saved." };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e; // redirect/notFound
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join(" ") };
    if (e instanceof DomainError || e instanceof AuthError) return { error: e.message };
    console.error("[action]", e);
    return { error: "Something went wrong. Please try again — if it persists, contact Omega Nannies." };
  }
}
export const password = z.string().min(10, "Password must be at least 10 characters.").max(200);
export const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
