import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";

/**
 * Typed, management-editable platform settings. Defaults apply until Omega confirms a policy.
 * addressReveal: the booking status from which an assigned nanny may see the precise address and children's care notes.
 */
export const SETTINGS = {
  addressReveal: z.enum(["confirmed", "in_progress"]).default("confirmed"),
  requireNannyAcceptance: z.boolean().default(true),
  retention: z.object({ messagesMonths: z.number(), closedAccountMonths: z.number(), financialYears: z.number() }).default({ messagesMonths: 24, closedAccountMonths: 12, financialYears: 5 }),
} as const;
type Key = keyof typeof SETTINGS;
const DB_KEY: Record<Key, string> = { addressReveal: "address_reveal", requireNannyAcceptance: "require_nanny_acceptance", retention: "retention" };

export async function getSetting<K extends Key>(key: K): Promise<z.infer<(typeof SETTINGS)[K]>> {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.key, DB_KEY[key]));
  const parsed = SETTINGS[key].safeParse(row?.value ?? undefined);
  return (parsed.success ? parsed.data : SETTINGS[key].parse(undefined)) as z.infer<(typeof SETTINGS)[K]>;
}
export async function setSetting<K extends Key>(key: K, value: unknown, userId: string) {
  const v = SETTINGS[key].parse(value);
  await db.insert(s.settings).values({ key: DB_KEY[key], value: v as object, updatedBy: userId }).onConflictDoUpdate({ target: s.settings.key, set: { value: v as object, updatedBy: userId, updatedAt: new Date() } });
}
