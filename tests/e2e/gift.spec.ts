import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

const EVENT = "/events/2026-10-25-flow-and-create";

async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(375);
}

test("/gift shows the four preset values and a custom amount", async ({ page }) => {
  await page.goto("/gift");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("gift card");
  const values = page.getByRole("radiogroup", { name: "Value" });
  for (const v of ["AED 250", "AED 500", "AED 1,000", "AED 2,500"]) {
    await expect(values.getByText(v, { exact: true })).toBeVisible();
  }
  await values.getByText("Custom amount").click();
  await expect(page.getByLabel(/Amount in AED/)).toBeVisible();
  await noHorizontalScroll(page);
});

test("quantity above one hides the recipient fields; send-to-me hides them too", async ({ page }) => {
  await page.goto("/gift");
  await expect(page.getByLabel("Recipient's email")).toBeVisible();
  await page.getByText("Send it to me").click();
  await expect(page.getByLabel("Recipient's email")).toHaveCount(0);
  await page.getByText("Send to a friend").click();
  await page.getByLabel("How many cards?").fill("5");
  await expect(page.getByLabel("Recipient's email")).toHaveCount(0);
  await expect(page.getByTestId("gift-total")).toContainText("AED 2,500");
  await noHorizontalScroll(page);
});

test("an event page links to /gift for that experience", async ({ page }) => {
  await page.goto(EVENT);
  const link = page.getByRole("link", { name: "Give this as a gift" });
  await expect(link).toHaveAttribute("href", "/gift?for=2026-10-25-flow-and-create");
  await link.click();
  await expect(page).toHaveURL(/\/gift\?for=/);
  await expect(page.getByLabel("Suggest an experience (optional)")).toHaveValue("2026-10-25-flow-and-create");
});

test("the footer links to /gift", async ({ page }) => {
  await page.goto("/faq");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Gift cards" })).toHaveAttribute("href", "/gift");
});

test("/now links to /gift", async ({ page }) => {
  await page.goto("/now");
  await expect(page.getByRole("main").getByRole("link", { name: "Gift cards" })).toHaveAttribute("href", "/gift");
});

test("/gift/balance has the balance box and answers politely without a database", async ({ page }) => {
  await page.goto("/gift/balance");
  await page.getByLabel("Gift card code").fill("EFZG-AAAA-BBBB");
  await page.getByRole("button", { name: "Check balance" }).click();
  await expect(page.getByRole("status")).toContainText(/cannot be checked|could not find/i);
  await noHorizontalScroll(page);
});
