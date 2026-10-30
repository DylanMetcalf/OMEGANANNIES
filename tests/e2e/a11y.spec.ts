import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetLoginLimits } from "./limits";

/** Audit 3 — automated WCAG 2.2 AA checks (axe-core) across every role. Fails on serious/critical issues. */
const PAGES: Record<string, string[]> = {
  "-": ["/", "/login", "/register", "/forgot-password", "/help", "/claim?token=x"],
  "family.demo@example.com": ["/family", "/family/book", "/family/book/nannies?service=holiday&start=2026-12-20&area=Atlantic+Seaboard", "/family/book/nannies?service=holiday&start=2026-12-20&area=Atlantic+Seaboard&preview=amahle-n", "/family/book/review", "/family/shortlist", "/family/nannies/amahle-n", "/family/bookings", "/family/my-family", "/family/my-family?tab=children", "/family/payments", "/family/documents", "/account", "/notifications", "/messages"],
  "nanny.demo@example.com": ["/nanny", "/nanny/bookings", "/nanny/availability", "/nanny/profile", "/nanny/documents", "/nanny/onboarding"],
  "admin.demo@example.com": ["/manage", "/manage/bookings", "/manage/nannies", "/manage/families", "/manage/tasks", "/manage/pricing", "/manage/reports", "/manage/content", "/manage/support", "/manage/admin", "/manage/insights", "/manage/growth"],
};
test.beforeEach(resetLoginLimits);
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("OmegaDemo2026!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
for (const [who, paths] of Object.entries(PAGES)) {
  test(`@mobile accessibility: ${who === "-" ? "public" : who.split(".")[0]} pages`, async ({ page }) => {
    if (who !== "-") await login(page, who);
    const failures: string[] = [];
    for (const path of paths) {
      await page.goto(path);
      await page.waitForTimeout(450); // let the 160ms entrance fade finish: axe measures contrast at current opacity
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical"))
        failures.push(`${path}: ${v.id} — ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join("; ")}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

test("keyboard-only: skip link, sign-in and primary navigation", async ({ page }) => {
  await page.goto("/login");
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
  await page.getByLabel("Email").focus();
  await page.keyboard.type("family.demo@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab"); // past "Forgot password?" link
  await page.keyboard.type("OmegaDemo2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/family$/);
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  // Focus is always visible: the focused element has an outline
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});
