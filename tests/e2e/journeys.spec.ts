import { expect, test, type Page } from "@playwright/test";

/** Runs against the DEMO environment (npm run db:seed:demo). Exercises the real UI, server actions and database. */
const PW = "OmegaDemo2026!";
const stamp = Date.now().toString(36);
const famEmail = `e2e-${stamp}@example.com`;
let bookingUrl = "";

async function login(page: Page, email: string, password = PW) {
  await go(page, "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
/** Wait for hydration so forms submit through React (progressive-enhancement fallback is tested separately). */
async function hydrated(page: Page) { await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1"); }
async function go(page: Page, url: string) { const r = await page.goto(url); await hydrated(page); return r; }
async function logout(page: Page) { await page.context().clearCookies(); }

test.describe.serial("family → management → payment → nanny", () => {
  test("family registers, verifies email and signs in", async ({ page }) => {
    await go(page, "/register");
    await page.getByLabel("Your full name").fill("E2E Parent");
    await page.getByLabel("Email").fill(famEmail);
    await page.getByLabel("Password").fill(PW);
    await page.getByLabel("Household name").fill(`E2E household ${stamp}`);
    await page.getByLabel(/privacy notice/).check();
    await page.getByRole("button", { name: "Create account" }).click();
    const link = (await page.getByText(/Continue here: \/verify-email\?token=/).textContent())!.match(/\/verify-email\?token=\S+/)![0];
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    await login(page, famEmail);
    await expect(page).toHaveURL(/\/family$/);
  });

  test("family adds a child and location, then requests Amahle", async ({ page }) => {
    await login(page, famEmail);
    await go(page, "/family/children");
    const add = page.locator("section", { hasText: "Add a child" });
    await add.getByLabel("Preferred name").fill("Mia");
    await add.getByLabel("Date of birth").fill("2021-06-01");
    await add.getByLabel("Allergies").fill("Bee stings");
    await add.getByRole("checkbox").check();
    await add.getByRole("button", { name: "Add child" }).click();
    await expect(page.getByRole("heading", { name: /Mia/ })).toBeVisible();
    await go(page, "/family/profile");
    await page.getByLabel("Label", { exact: true }).fill("Villa");
    await page.getByLabel("Area", { exact: true }).selectOption("Atlantic Seaboard");
    await page.getByLabel("Address", { exact: true }).fill("1 Test Road");
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByText("Location added.")).toBeVisible();

    await go(page, "/family/nannies?q=Amahle");
    await page.getByRole("link", { name: "View profile" }).first().click();
    await page.getByRole("link", { name: /Request Amahle/ }).click();
    await hydrated(page);
    const d = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
    await page.getByLabel("Start date").fill(d);
    await page.getByLabel("Daily start").fill("09:00");
    await page.getByLabel("Daily finish").fill("17:00");
    await page.getByLabel(/I understand this is a/).check();
    await page.getByRole("button", { name: "Send booking request" }).click();
    await expect(page.getByText("Request received")).toBeVisible();
    bookingUrl = page.url().split("?")[0];
    await expect(page.getByText("Enquiry received").first()).toBeVisible();
  });

  test("manager matches, assigns, quotes and sends", async ({ page }) => {
    await login(page, "manager.demo@example.com");
    await go(page, bookingUrl.replace("/family/", "/manage/"));
    await page.getByRole("button", { name: "Run matching" }).click();
    await expect(page.getByText(/eligible of/)).toBeVisible();
    const row = page.locator("li", { hasText: "Amahle N." }).filter({ has: page.getByRole("button", { name: "Assign" }) });
    await row.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("Assigned:")).toBeVisible();
    await page.getByRole("button", { name: "Create draft quotation" }).click();
    await expect(page.getByText(/Draft quotation created/)).toBeVisible();
    await page.getByRole("button", { name: "Send to family" }).click();
    await expect(page.getByText("Quote ready for you").first()).toBeVisible();
  });

  test("family accepts the quote and pays the deposit; booking confirms only after provider notification", async ({ page }) => {
    await login(page, famEmail);
    await go(page, bookingUrl);
    await page.getByLabel(/I accept this quotation/).check();
    await page.getByRole("button", { name: "Accept quotation" }).click();
    await expect(page.getByText(/dates are held/).first()).toBeVisible();
    await page.reload();
    await hydrated(page);
    await page.getByRole("button", { name: /^Pay R/ }).first().click();
    await page.waitForURL(/\/pay\/demo\//);
    await hydrated(page);
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
    await page.goto(bookingUrl);
    await expect(page.getByText("Confirmed").first()).toBeVisible();
  });

  test("assigned nanny sees care instructions; family B cannot see the booking", async ({ page }) => {
    await login(page, "nanny.demo@example.com");
    await page.goto(bookingUrl.replace("/family/", "/nanny/"));
    await expect(page.getByText("Bee stings")).toBeVisible();
    await logout(page);
    await login(page, "family2.demo@example.com");
    const r = await page.goto(bookingUrl);
    expect(r?.status()).toBe(404);
  });
});

test("role boundaries are enforced server-side", async ({ page, request }) => {
  await login(page, "family.demo@example.com");
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/forbidden/);
  const anon = await request.get("/api/reports/export", { maxRedirects: 0 });
  expect(anon.status()).toBe(404);
  const forged = await request.post("/api/payments/payfast/notify", { data: "m_payment_id=x&pf_payment_id=1&payment_status=COMPLETE&amount_gross=1.00&signature=bad", headers: { "content-type": "application/x-www-form-urlencoded" } });
  expect(forged.status()).toBe(400);
  const site = await request.post("/api/enquiries", { data: { enquiryId: "x" }, headers: { "x-omega-signature": "nope" } });
  expect([401, 503]).toContain(site.status());
});

test("@mobile family home and navigation work on a phone", async ({ page }) => {
  await login(page, "family.demo@example.com");
  await expect(page.getByRole("heading", { name: /Good to see you/ })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Bookings" }).click();
  await expect(page).toHaveURL(/\/family\/bookings/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
