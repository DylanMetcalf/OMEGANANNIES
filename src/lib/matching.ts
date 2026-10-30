/**
 * Explainable, rules-based matching. Hard requirements exclude a candidate; preferences only rank.
 * The engine recommends — management decides. Overrides are recorded with a reason (bookings service).
 */
export type MatchRequirements = {
  serviceCode: string; ageGroups: string[]; requiredLanguages: string[]; needsDriver: boolean; specialist: boolean;
  area: string | null; requestedNannyId: string | null; budgetMaxMinor: number | null; estimatedTotalMinor: number | null;
  preferredNannyIds?: string[];
};
export type Candidate = {
  id: string; displayName: string; status: string; published: boolean; services: string[]; languages: string[]; ageGroups: string[];
  areas: string[]; canDrive: boolean; yearsExperience: number; specialistExperience: string | null; skills: string[];
  checks: { kind: string; status: string; expiresOn: string | null }[];
  conflicts: { startsAt: Date; endsAt: Date; reason: string }[];
  outsideAvailability: string[]; // dates outside declared availability (needs review, not exclusion)
  previousBookingsWithFamily: number;
};
export type Reason = { kind: "hard_fail" | "match" | "preference" | "review"; text: string; points?: number };
export type MatchResult = { nannyId: string; displayName: string; eligible: boolean; score: number; reasons: Reason[] };

const SAFEGUARDING = ["police_clearance", "first_aid", "identity", "reference"] as const;
const LABEL: Record<string, string> = { police_clearance: "Police clearance", first_aid: "First Aid certificate", identity: "Identity verification", reference: "Reference check" };

export function evaluate(c: Candidate, r: MatchRequirements, today = new Date().toISOString().slice(0, 10)): MatchResult {
  const reasons: Reason[] = [];
  const fail = (text: string) => reasons.push({ kind: "hard_fail", text });
  if (c.status !== "approved") fail(`Profile status is ${c.status}`);
  if (!c.services.includes(r.serviceCode)) fail("Does not offer this service");
  for (const kind of SAFEGUARDING) {
    const ok = c.checks.find((k) => k.kind === kind && k.status === "passed" && (!k.expiresOn || k.expiresOn >= today));
    if (!ok) fail(`${LABEL[kind]} not current`);
  }
  const missingLang = r.requiredLanguages.filter((l) => !c.languages.map((x) => x.toLowerCase()).includes(l.toLowerCase()));
  if (missingLang.length) fail(`Missing required language: ${missingLang.join(", ")}`);
  if (r.needsDriver && !c.canDrive) fail("Driving required");
  if (r.specialist && !c.services.includes("special_needs") && !c.specialistExperience) fail("No recorded specialist / additional-needs experience");
  const missingAges = r.ageGroups.filter((a) => !c.ageGroups.includes(a));
  if (missingAges.length) fail(`No recorded experience with age group: ${missingAges.join(", ")}`);
  for (const k of c.conflicts.slice(0, 3)) fail(`Conflict: ${k.reason}`);

  let score = 40;
  const add = (points: number, text: string, kind: Reason["kind"] = "preference") => { score += points; reasons.push({ kind, text, points }); };
  if (r.area && c.areas.some((a) => a.toLowerCase() === r.area!.toLowerCase())) add(15, `Covers ${r.area}`);
  else if (r.area) reasons.push({ kind: "review", text: `Travel to ${r.area} needs confirming` });
  add(Math.min(15, c.yearsExperience * 1.5) | 0, `${c.yearsExperience} years' experience`);
  const rank = r.preferredNannyIds?.indexOf(c.id) ?? -1;
  if (rank >= 0) add([15, 10, 6][rank] ?? 4, `Family's ${["1st", "2nd", "3rd"][rank] ?? `${rank + 1}th`} preference`);
  else if (r.requestedNannyId === c.id) add(15, "Requested by the family");
  if (c.previousBookingsWithFamily > 0) add(10, `Has cared for this family before (${c.previousBookingsWithFamily}×)`);
  if (r.specialist && c.specialistExperience) add(5, "Specialist experience recorded");
  if (c.canDrive && !r.needsDriver) add(2, "Can drive");
  if (r.budgetMaxMinor && r.estimatedTotalMinor && r.estimatedTotalMinor > r.budgetMaxMinor) reasons.push({ kind: "review", text: "Estimated price exceeds the family's stated budget" });
  if (c.outsideAvailability.length) { score -= 10; reasons.push({ kind: "review", text: `Outside declared availability on ${c.outsideAvailability.length} day(s) — confirm with nanny`, points: -10 }); }
  if (reasons.every((x) => x.kind !== "hard_fail")) reasons.unshift({ kind: "match", text: "Meets all hard requirements" });
  const eligible = !reasons.some((x) => x.kind === "hard_fail");
  return { nannyId: c.id, displayName: c.displayName, eligible, score: eligible ? Math.max(0, Math.min(100, score)) : 0, reasons };
}

export function rank(cands: Candidate[], r: MatchRequirements, today?: string): MatchResult[] {
  return cands.map((c) => evaluate(c, r, today)).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.displayName.localeCompare(b.displayName));
}
