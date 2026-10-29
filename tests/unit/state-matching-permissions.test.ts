import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses, STATUSES } from "@/lib/booking-state";
import { evaluate, rank, type Candidate, type MatchRequirements } from "@/lib/matching";
import { can, homeFor, permissionsOf } from "@/lib/permissions";

describe("booking state machine", () => {
  it("allows the happy path with the right actors only", () => {
    expect(canTransition("enquiry", "matching", "management")).toBe(true);
    expect(canTransition("awaiting_approval", "awaiting_payment", "family")).toBe(true);
    expect(canTransition("awaiting_approval", "awaiting_payment", "management")).toBe(false);
    expect(canTransition("awaiting_payment", "confirmed", "system")).toBe(true);
    expect(canTransition("awaiting_payment", "confirmed", "family")).toBe(false);
    expect(canTransition("confirmed", "in_progress", "nanny")).toBe(true);
  });
  it("rejects skipping states and leaving terminal states", () => {
    expect(canTransition("enquiry", "confirmed", "management")).toBe(false);
    expect(canTransition("refunded", "confirmed", "management")).toBe(false);
    expect(nextStatuses("declined", "management")).toEqual([]);
    for (const s of STATUSES) expect(canTransition(s, s, "management")).toBe(false);
  });
});

const req: MatchRequirements = { serviceCode: "holiday", ageGroups: ["toddler"], requiredLanguages: ["German"], needsDriver: true, specialist: false, area: "Atlantic Seaboard", requestedNannyId: null, budgetMaxMinor: null, estimatedTotalMinor: null };
const checks = ["interview", "reference", "identity", "police_clearance", "first_aid"].map((kind) => ({ kind, status: "passed", expiresOn: "2099-01-01" }));
const cand = (o: Partial<Candidate>): Candidate => ({ id: "a", displayName: "A", status: "approved", published: true, services: ["holiday"], languages: ["English", "German"], ageGroups: ["toddler"], areas: ["Atlantic Seaboard"], canDrive: true, yearsExperience: 6, specialistExperience: null, skills: [], checks, conflicts: [], outsideAvailability: [], previousBookingsWithFamily: 0, ...o });

describe("matching", () => {
  it("excludes candidates failing hard requirements, with reasons", () => {
    const r = evaluate(cand({ canDrive: false, checks: checks.filter((c) => c.kind !== "police_clearance") }), req, "2027-01-01");
    expect(r.eligible).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reasons.filter((x) => x.kind === "hard_fail").map((x) => x.text).join()).toMatch(/Driving.*|Police clearance/);
  });
  it("treats expired safeguarding checks and booking conflicts as hard fails", () => {
    expect(evaluate(cand({ checks: checks.map((c) => (c.kind === "first_aid" ? { ...c, expiresOn: "2020-01-01" } : c)) }), req, "2027-01-01").eligible).toBe(false);
    expect(evaluate(cand({ conflicts: [{ startsAt: new Date(), endsAt: new Date(), reason: "booked" }] }), req).eligible).toBe(false);
  });
  it("ranks eligible candidates by explainable preference points", () => {
    const out = rank([cand({ id: "x", displayName: "X", yearsExperience: 2, areas: [] }), cand({ id: "y", displayName: "Y", previousBookingsWithFamily: 2 }), cand({ id: "z", displayName: "Z", languages: ["English"] })], req, "2027-01-01");
    expect(out.map((r) => r.nannyId)).toEqual(["y", "x", "z"]);
    expect(out[0].reasons.some((r) => /cared for this family/.test(r.text))).toBe(true);
    expect(out[2].eligible).toBe(false);
  });
});

describe("permissions", () => {
  const p = (roles: never[], permissions: string[] = [], status = "active") => ({ id: "u", roles, permissions, status });
  it("gives families and nannies no management permissions, even if granted", () => {
    expect(permissionsOf(p(["family"] as never[], ["bookings.manage"])).size).toBe(0);
    expect(can(p(["nanny"] as never[], ["users.manage"]), "users.manage")).toBe(false);
  });
  it("scopes ops staff to granted permissions and denies suspended users", () => {
    expect(can(p(["ops"] as never[]), "bookings.manage")).toBe(false);
    expect(can(p(["ops"] as never[], ["bookings.manage"]), "bookings.manage")).toBe(true);
    expect(can(p(["ops"] as never[], ["not.a.permission"]), "users.manage")).toBe(false);
    expect(can(p(["admin"] as never[], [], "suspended"), "users.manage")).toBe(false);
    expect(can(p(["manager"] as never[]), "users.manage")).toBe(false);
    expect(homeFor(p(["manager"] as never[]))).toBe("/manage");
  });
});
