import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

const EVENT = "/events/2026-10-25-flow-and-create";
const RETREAT = "/retreats/reform-athletica-retreat";

async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(375);
}

test("event page: story, schedule, local price, sticky Book bar, policy", async ({ page }) => {
  await page.goto(EVENT);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Flow & Create");
  await expect(page.getByText("Grounding flow session", { exact: true })).toBeVisible();
  await expect(page.getByText("Pottery painting").first()).toBeVisible();
  const bar = page.getByTestId("sticky-book-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByText("AED 280")).toBeVisible();
  await expect(bar.getByText(/≈ £\d+/)).toBeVisible();
  await expect(bar.getByRole("link", { name: "Book" })).toHaveAttribute("href", /\/book\/2026-10-25-flow-and-create/);
  await expect(page.getByText(/more than 48 hours/i)).toBeVisible();
  await noHorizontalScroll(page);
});

test("events list: Dubai/Abroad and Move/Nourish/Thrive filters change cards", async ({ page }) => {
  await page.goto("/events");
  const cards = page.getByTestId("experience-card");
  await expect(cards).toHaveCount(2);

  await page.getByRole("button", { name: "Abroad", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Reform Athletica");

  await page.getByRole("button", { name: "Dubai", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Flow & Create");

  await page.getByRole("button", { name: "Nourish", exact: true }).click();
  await expect(cards).toHaveCount(0);

  await page.getByRole("button", { name: "All places", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Reform Athletica");

  await page.getByRole("button", { name: "Thrive", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await noHorizontalScroll(page);
});

test("Book panel lists at most four upcoming experiences", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Book" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const items = dialog.getByTestId("panel-item");
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(4);
  await expect(dialog.getByText("Flow & Create")).toBeVisible();
  await expect(dialog.getByText("Strong Body")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("/now lists what is on sale", async ({ page }) => {
  await page.goto("/now");
  await expect(page.getByRole("link", { name: /Flow & Create/ }).first()).toBeVisible();
  await expect(page.getByText("Strong Body")).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("retreat with interest status: Register interest and WhatsApp", async ({ page }) => {
  await page.goto(RETREAT);
  await expect(page.getByRole("link", { name: "Register interest" }).first()).toHaveAttribute(
    "href",
    /\/bespoke\?type=retreat_interest&slug=reform-athletica-retreat/,
  );
  await expect(page.locator('a[href^="https://wa.me/"]').first()).toBeVisible();
  await noHorizontalScroll(page);
});

test("retreats index and home render in section order without overflow", async ({ page }) => {
  await page.goto("/retreats");
  await expect(page.getByRole("link", { name: /Reform Athletica/ }).first()).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto("/");
  await expect(page.getByText("Ancient Wisdom for Modern Living").first()).toBeVisible();
  const order = ["intro", "pillars", "upcoming", "retreat", "bespoke", "founder", "instagram", "newsletter"];
  const ys: number[] = [];
  for (const id of order) {
    const el = page.getByTestId(`section-${id}`);
    await expect(el, id).toHaveCount(1);
    ys.push(await el.evaluate((n) => n.getBoundingClientRect().top + window.scrollY));
  }
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  await expect(page.getByText("Κίνηση")).toBeVisible();
  await noHorizontalScroll(page);
});