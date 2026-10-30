import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/** Audit 2 — HTTP-level negative tests against the running demo (synthetic data only). */
const PW = "OmegaDemo2026!";
const DB = process.env.DATABASE_URL ?? "postgres://omega:omega@localhost:5432/omega";
async function q<T = Record<string, string>>(sql: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  try { return (await c.query(sql)).rows as T[]; } finally { await c.end(); }
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("a signed document link is bound to the user it was issued to", async ({ page, browser }) => {
  const [doc] = await q("select d.id, d.owner_nanny_id from documents d where d.owner_nanny_id is not null limit 1");
  test.skip(!doc, "no nanny documents in the demo database yet (run journeys first)");
  await login(page, "admin.demo@example.com");
  await page.goto(`/manage/nannies/${doc.owner_nanny_id}`);
  const href = await page.getByRole("link", { name: "Open" }).first().getAttribute("href");
  expect(href).toMatch(/\/api\/documents\/.+\?exp=\d+&sig=/);
  expect((await page.request.get(href!)).status()).toBe(200);
  const other = await (await browser.newContext()).newPage();
  await login(other, "family.demo@example.com");
  expect((await other.request.get(href!)).status()).toBe(403); // link stolen by another user
  const forged = href!.replace(/sig=[^&]+/, "sig=AAAA");
  expect((await other.request.get(forged)).status()).toBe(403);
  const anon = await (await browser.newContext()).request.get(href!);
  expect(anon.status()).toBe(401);
});

test("unpublished (imported draft) nanny photos are not visible to families", async ({ page }) => {
  const [n] = await q("select id from nannies where photo_key is not null and (published = false or status <> 'approved') limit 1");
  test.skip(!n, "no unpublished nanny with a photo");
  await login(page, "family.demo@example.com");
  expect((await page.request.get(`/api/photos/${n.id}`)).status()).toBe(404);
});

test("data export contains only the signed-in user's own records", async ({ page }) => {
  await login(page, "family.demo@example.com");
  const r = await page.request.get("/api/account/export");
  expect(r.status()).toBe(200);
  const body = await r.text();
  expect(body).toContain("family.demo@example.com");
  expect(body).not.toContain("family2.demo@example.com");
  expect(body).not.toContain("Van der Berg");
  expect(body).not.toContain("password");
  expect(body).not.toContain("storageKey");
});

test("role boundaries hold for direct URLs", async ({ page }) => {
  await login(page, "family.demo@example.com");
  for (const path of ["/manage", "/manage/tasks", "/manage/nannies", "/nanny"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/forbidden/);
  }
  expect((await page.request.get("/api/reports/export")).status()).toBe(404);
});

test("security headers are set", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("unauthenticated private endpoints refuse access", async ({ request }) => {
  expect((await request.get("/api/documents/00000000-0000-0000-0000-000000000000?exp=1&sig=x")).status()).toBe(401);
  expect((await request.get("/api/photos/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
  expect((await request.get("/api/account/export")).status()).toBe(401);
  const r = await request.get("/family", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
});

test("an expired or revoked session cannot read pages or run actions", async ({ page }) => {
  await login(page, "family.demo@example.com");
  await page.goto("/account");
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
  // Revoke the session server-side (as expiry, sign-out elsewhere or suspension would) while the page stays open.
  await q("delete from sessions where id = (select s.id from sessions s join users u on u.id = s.user_id where u.email = 'family.demo@example.com' order by s.created_at desc limit 1)");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Not signed in" })).toBeVisible();
  await page.goto("/family");
  await expect(page).toHaveURL(/\/login/);
});
