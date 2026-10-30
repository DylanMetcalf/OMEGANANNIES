import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { familyIdsOf } from "@/lib/bookings";
import { getDraft } from "@/lib/journey";
import { reqToParams } from "@/lib/journey-core";

/** "Continue booking": return to the step the family left, with their answers intact. */
export default async function Resume() {
  const u = await requireUser({ role: "family" });
  const [familyId] = await familyIdsOf(u.id);
  const d = await getDraft(familyId);
  if (d.step === "review") redirect("/family/book/review");
  if (d.step === "discover") redirect(`/family/book/nannies?${reqToParams(d.req)}`);
  redirect("/family/book");
}
