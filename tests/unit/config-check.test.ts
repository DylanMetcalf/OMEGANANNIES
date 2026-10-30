import { describe, expect, it } from "vitest";
import { configProblems } from "@/lib/config-check";

const S = "x".repeat(40);
describe("configProblems", () => {
  it("refuses demo mode with live merchant credentials", () => {
    expect(configProblems({ NODE_ENV: "production", APP_SECRET: S, DEMO_MODE: "true", PAYFAST_MERCHANT_ID: "1", PAYFAST_SANDBOX: "false" }).fatal).toHaveLength(1);
  });
  it("refuses a missing secret and a non-https live URL", () => {
    expect(configProblems({ NODE_ENV: "production", APP_URL: "http://x" }).fatal).toHaveLength(2);
  });
  it("warns about every unconfigured production dependency, without exposing values", () => {
    const r = configProblems({ NODE_ENV: "production", APP_SECRET: S, APP_URL: "https://app.example" });
    expect(r.fatal).toEqual([]);
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
    expect(r.warnings.join(" ")).not.toContain(S);
  });
  it("is quiet for the demo", () => {
    expect(configProblems({ NODE_ENV: "production", APP_SECRET: S, DEMO_MODE: "true" })).toEqual({ fatal: [], warnings: [] });
  });
});
