import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

// Loaded from tests/e2e/fixtures via EFZIN_EXTRA_CONTENT_DIR (see playwright.config.ts).
const RETREAT = "/book/e2e-retreat";

test("option picker shows the schedule for the retreat fixture", async ({ page }) => {
  await page.goto(RETREAT);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Retreat");

  const options = page.getByRole("radiogroup", { name: "How would you like to pay?" });
  await expect(options.getByRole("radio")).toHaveCount(3);
  await expect(page.getByTestId("schedule-table")).toHaveCount(0);

  await options.getByRole("radio", { name: /Deposit \+ monthly payments/ }).check();
  const table = page.getByTestId("schedule-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(1 + 5); // header + deposit + 4 monthly
  await expect(table.getByText("Today")).toBeVisible();
  await expect(table.getByText("€480").first()).toBeVisible();
  await expect(page.getByText("Later payments are charged in EUR; your bank converts")).toBeVisible();

  await options.getByRole("radio", { name: /Deposit \+ balance/ }).check();
  await expect(table.getByRole("row")).toHaveCount(1 + 2);

  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(375);
});

test("consent checkbox is required for a payment plan", async ({ page }) => {
  await page.goto(RETREAT);
  await page.getByLabel("Your name").fill("Layla Haddad");
  await page.getByLabel("Email").fill("layla@example.com");
  await page.getByLabel("Phone").fill("+971500000000");
  await page.getByRole("radio", { name: /Deposit \+ balance/ }).check();
  await page.getByLabel(/I accept the cancellation policy/).check();

  const consent = page.getByLabel("Ef Zin will charge this card on these dates");
  await expect(consent).toBeVisible();
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: /Continue to payment/ }).click();
  expect(await consent.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`${RETREAT}$`));

  await page.getByRole("radio", { name: /Pay in full/ }).check();
  await expect(page.getByLabel("Ef Zin will charge this card on these dates")).toHaveCount(0);
});

test("adding a ticket asks for a guest's details", async ({ page }) => {
  await page.goto(RETREAT);
  await page.getByRole("button", { name: "Add one Shared room" }).click();
  await expect(page.getByText("Guest 2 · Shared room")).toBeVisible();
  await expect(page.getByLabel("Guest 2 name")).toBeVisible();
});

test("returning from a cancelled checkout says nothing was charged and keeps the form", async ({ page }) => {
  await page.goto(`${RETREAT}?cancelled=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByText("Checkout cancelled. Nothing was charged")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeVisible();
});

test("an experience that is not on sale shows Not currently available", async ({ page }) => {
  await page.goto("/book/reform-athletica-retreat");
  await expect(page.getByText("Not currently available")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to/ })).toHaveAttribute("href", "/retreats/reform-athletica-retreat");
});
