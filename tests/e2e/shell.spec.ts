import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

test("mobile shell: nav, book button, footer, no horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Book" })).toBeVisible();
  await expect(page.getByRole("banner").getByAltText("Ef Zin", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  for (const label of ["Events", "Retreats", "Bespoke", "Coaching", "Journal", "About"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);

  const footer = page.getByRole("contentinfo");
  for (const label of ["FAQ", "Contact", "Terms", "Privacy"]) {
    await expect(footer.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(footer.getByText("contact@efzinwellness.com")).toBeVisible();
});
