import { expect, test, type Page } from "@playwright/test";
import { resetLoginLimits } from "./limits";

/** Runs against the DEMO environment (npm run db:seed:demo). Exercises the real UI, server actions and database. */
const PW = "OmegaDemo2026!";
const stamp = Date.now().toString(36);
const famEmail = `e2e-${stamp}@example.com`;
let bookingUrl = "";

test.beforeEach(resetLoginLimits);
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
    const link = (await page.getByText(/Continue here: \/verify-email\?token=/).first().textContent())!.match(/\/verify-email\?token=\S+/)![0];
    await go(page, link);
    await page.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(page.getByText(/Email confirmed/)).toBeVisible();
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
    // Unique future date per run so repeated runs never collide with earlier E2E bookings for the same nanny.
    const d = new Date(Date.now() + (150 + (parseInt(stamp, 36) % 600)) * 86400_000).toISOString().slice(0, 10);
    await page.getByLabel("Start date").fill(d);
    await page.getByLabel("Daily start").fill("09:00");
    await page.getByLabel("Daily finish").fill("17:00");
    await page.getByLabel(/I understand this is a/).check();
    await page.getByRole("button", { name: "Send booking request" }).click();
    await expect(page.getByText("Request received")).toBeVisible();
    bookingUrl = page.url().split("?")[0];
    await expect(page.getByText("Enquiry received").first()).toBeVisible();
  });

  test("manager matches and offers the booking to Amahle", async ({ page }) => {
    await login(page, "manager.demo@example.com");
    await go(page, bookingUrl.replace("/family/", "/manage/"));
    await page.getByRole("button", { name: "Run matching" }).click();
    await expect(page.getByText(/eligible of/)).toBeVisible();
    const row = page.locator("li", { hasText: "Amahle N." }).filter({ has: page.getByRole("button", { name: "Assign", exact: true }) });
    await row.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Awaiting nanny’s response")).toBeVisible();
  });

  test("nanny sees the offer without the address, and accepts", async ({ page }) => {
    await login(page, "nanny.demo@example.com");
    await go(page, bookingUrl.replace("/family/", "/nanny/"));
    await expect(page.getByText("Omega is offering you this booking")).toBeVisible();
    await expect(page.getByText("1 Test Road")).toHaveCount(0);
    await expect(page.getByText("Bee stings")).toHaveCount(0);
    await page.getByRole("button", { name: "Accept offer" }).click();
    await expect(page.getByText("Omega is offering you this booking")).toHaveCount(0);
  });

  test("manager quotes and sends", async ({ page }) => {
    await login(page, "manager.demo@example.com");
    await go(page, bookingUrl.replace("/family/", "/manage/"));
    await expect(page.getByText("Nanny accepted")).toBeVisible();
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
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1"); // the drawer opens via client JS
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Bookings" }).click();
  await expect(page).toHaveURL(/\/family\/bookings/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test.describe.serial("pre-created nanny profile → invitation → claim → onboarding → approval", () => {
  const name = `Zanele ${stamp}`;
  const nannyEmail = `zanele-${stamp}@example.com`;
  let recordUrl = "", claimLink = "";
  const pdf = (n: string) => ({ name: n, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });

  test("admin creates a draft profile without an email, then adds one and invites", async ({ page }) => {
    await login(page, "admin.demo@example.com");
    await go(page, "/manage/nannies");
    await page.getByLabel("Display name").fill(name);
    await page.getByRole("button", { name: "Create draft profile" }).click();
    await page.waitForURL(/\/manage\/nannies\/[0-9a-f-]{36}$/);
    recordUrl = page.url();
    await hydrated(page);
    await expect(page.getByText("Draft — no contact email").first()).toBeVisible();
    // Fill reviewed profile fields as Omega
    await page.getByRole("textbox", { name: "Headline" }).fill("Calm, creative and kind.");
    await page.getByRole("textbox", { name: "Biography" }).fill("Zanele has cared for children for six years across holiday and event placements, with a love of outdoor play and crafts.");
    for (const c of ["Holiday Nanny", "English", "School age", "Atlantic Seaboard"]) await page.getByRole("checkbox", { name: c, exact: true }).first().check({ force: true });
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.getByLabel("Email address").fill(nannyEmail);
    await page.getByRole("button", { name: "Save contact" }).click();
    await expect(page.getByText("Contact details saved.")).toBeVisible();
    await page.reload(); await hydrated(page);
    await page.getByRole("button", { name: "Send invitation" }).click();
    const msg = await page.getByText(/one-time link securely: \/claim\?token=/).first().textContent();
    claimLink = msg!.match(/\/claim\?token=\S+/)![0];
  });

  test("claim is bound to the invited email; a wrong email fails without revealing details", async ({ page }) => {
    await go(page, claimLink);
    await page.getByLabel(/Email address the invitation/).fill(`someone-else-${stamp}@example.com`);
    await page.getByLabel("Your full name").fill("Imposter");
    await page.getByLabel("Choose a password").fill(PW);
    await page.getByLabel(/privacy notice/).check();
    await page.getByRole("button", { name: "Claim my profile" }).click();
    await expect(page.getByText(/isn’t valid/)).toBeVisible();
    await page.getByLabel(/Email address the invitation/).fill(nannyEmail);
    await page.getByLabel("Your full name").fill("Zanele Test");
    await page.getByRole("button", { name: "Claim my profile" }).click();
    await page.waitForURL(/\/login\?welcome=1/);
    // Single use: the same link no longer works
    await go(page, claimLink);
    await expect(page.getByText("This invitation can’t be used")).toBeVisible();
  });

  test("nanny completes onboarding and submits; claiming does not approve", async ({ page }) => {
    await login(page, nannyEmail);
    await go(page, "/nanny/onboarding");
    await page.getByRole("button", { name: "These details are correct" }).click();
    await expect(page.getByText("Confirmed by you").first()).toBeVisible();
    for (const [v, f] of [["id_document", "id.pdf"], ["police_clearance", "pcc.pdf"], ["first_aid", "fa.pdf"]]) {
      await page.getByLabel("Document").selectOption(v);
      await page.getByLabel(/^File/).setInputFiles(pdf(f));
      await page.getByRole("button", { name: "Upload securely" }).click();
      await expect(page.getByText(/Uploaded\./)).toBeVisible();
      await page.reload(); await hydrated(page);
    }
    await page.getByLabel("Photo").setInputFiles("public/icons/icon-192.png");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Photo added.")).toBeVisible();
    await page.reload(); await hydrated(page);
    await page.getByRole("button", { name: "Submit my profile" }).click();
    await expect(page.getByText(/Submitted\. Omega will review/)).toBeVisible();
    // Not bookable / not visible to families yet
    await logout(page);
    await login(page, "family.demo@example.com");
    await go(page, `/family/nannies?q=Zanele`);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("admin cannot approve without checks; records checks, approves docs, approves and publishes", async ({ page }) => {
    await login(page, "admin.demo@example.com");
    await go(page, recordUrl);
    const status = () => page.locator("section", { hasText: "Status & publication" });
    const docs = () => page.locator("section", { hasText: "Required: id document" });
    await status().getByRole("textbox", { name: "Reason" }).fill("E2E");
    page.once("dialog", (d) => d.accept());
    await status().getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText(/Cannot approve: .* not passed/)).toBeVisible();
    for (const k of ["interview", "reference", "identity", "police clearance", "first aid"]) {
      await page.getByLabel("Check", { exact: true }).selectOption({ label: k });
      await page.getByLabel("Completed on").fill(new Date().toISOString().slice(0, 10));
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await expect(page.getByText("Check recorded.").first()).toBeVisible();
      await page.reload(); await hydrated(page);
    }
    for (let i = 0; i < 3; i++) {
      await docs().getByRole("button", { name: "Approve", exact: true }).first().click();
      await expect(page.getByText("Document approved.").first()).toBeVisible();
      await page.reload(); await hydrated(page);
    }
    page.once("dialog", (d) => d.accept());
    await status().getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved.").first()).toBeVisible();
    await page.reload(); await hydrated(page);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Publish to families" }).click();
    await expect(page.getByText("Published to families.").first()).toBeVisible();
    await logout(page);
    await login(page, "family.demo@example.com");
    await go(page, `/family/nannies?q=Zanele`);
    await expect(page.getByText(name).first()).toBeVisible();
  });
});
