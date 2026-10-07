import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

async function noOverflow(page: import("@playwright/test").Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(375);
}

test("old Squarespace URLs redirect with a 301", async ({ request }) => {
  const a = await request.get("/ef-zin-retreats-1", { maxRedirects: 0 });
  expect(a.status()).toBe(301);
  expect(new URL(a.headers()["location"], "http://x").pathname).toBe("/events");
  const b = await request.get("/faqs", { maxRedirects: 0 });
  expect(b.status()).toBe(301);
  expect(new URL(b.headers()["location"], "http://x").pathname).toBe("/faq");
  const c = await request.get("/store/p/strongbody-calmmind-re", { maxRedirects: 0 });
  expect(c.status()).toBe(301);
  expect(c.headers()["location"]).toContain("/events/2026-10-04-strong-body-calm-mind");
});

test("bespoke shows two paths and the private enquiry shows a thank-you", async ({ page }) => {
  await page.goto("/bespoke");
  await expect(page.getByRole("heading", { name: "For you & yours" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "For your team" })).toBeVisible();

  const form = page.locator("#private form");
  await form.getByLabel("Your name").fill("Layla Test");
  await form.getByLabel("Email").fill("layla@example.com");
  await form.getByLabel("Who is it for?").selectOption("friends");
  await form.getByLabel("Where and when").selectOption("dubai_half_day");
  await form.getByRole("button", { name: "Move", exact: true }).click();
  await form.getByRole("button", { name: /send enquiry/i }).click();
  await expect(page.getByRole("status")).toContainText(/thank you/i);
  await noOverflow(page);
});

test("corporate page has the corporate fields", async ({ page }) => {
  await page.goto("/bespoke/corporate");
  await expect(page.getByLabel("Company")).toBeVisible();
  await expect(page.getByLabel("Invoicing contact")).toBeVisible();
  await noOverflow(page);
});

test("retreat interest pre-fill carries the slug", async ({ page }) => {
  await page.goto("/bespoke?type=retreat_interest&slug=reform-athletica-retreat");
  await expect(page.getByRole("heading", { name: /register your interest/i })).toBeVisible();
  let body: Record<string, unknown> = {};
  await page.route("**/api/requests", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, stored: false } });
  });
  await page.getByLabel("Your name").fill("Layla Test");
  await page.getByLabel("Email").fill("layla@example.com");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(page.getByRole("status")).toContainText(/thank you/i);
  expect(body.type).toBe("retreat_interest");
  expect(body.slug).toBe("reform-athletica-retreat");
});

test("coaching has the enquiry form and a WhatsApp button", async ({ page }) => {
  await page.goto("/coaching");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /whatsapp/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toBeVisible();
  await noOverflow(page);
});

for (const path of ["/about", "/faq", "/contact", "/terms", "/privacy", "/journal"]) {
  test(`${path} renders without horizontal scroll`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noOverflow(page);
  });
}

test("terms state fee deduction and 12-month credit; comment is not rendered", async ({ page }) => {
  await page.goto("/terms");
  const text = await page.locator("main").innerText();
  expect(text).toMatch(/Stripe/);
  expect(text).toMatch(/12 months/);
  expect(text).not.toMatch(/pending legal review/);
  const html = await page.content();
  expect(html).not.toContain("pending legal review");
});

test("journal lists posts and a post renders", async ({ page }) => {
  await page.goto("/journal");
  const links = page.locator("main a[href^='/journal/']");
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  await links.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("unknown page 404s", async ({ page }) => {
  const res = await page.goto("/not-a-real-page");
  expect(res?.status()).toBe(404);
});