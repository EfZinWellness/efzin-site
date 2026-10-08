import { test, expect, type BrowserContext, type Page } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

async function noHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(375);
}

/** Dev-only seam: with EFZIN_TEST_AUTH_EMAIL set on the server, this cookie signs in as that person. */
async function signInForTest(context: BrowserContext) {
  await context.addCookies([{ name: "efzin_test_auth", value: "1", url: "http://localhost:3000" }]);
}

test("an unauthenticated visit to /account goes to the sign-in page", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/signin$/);
  await page.goto("/account/health");
  await expect(page).toHaveURL(/\/account\/signin$/);
});

test("the sign-in page offers an email link and Google", async ({ page }) => {
  await page.goto("/account/signin");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in");
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText(/no password/i)).toBeVisible();
  await noHorizontalScroll(page);
});

test("a signed-in member without a database sees an empty account, not an error", async ({ page, context }) => {
  await signInForTest(context);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("My Ef Zin");
  await expect(page.getByText("No upcoming bookings yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Health details" }).first()).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto("/account/gift-cards");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Gift cards");
  await noHorizontalScroll(page);
});

test("saving health details without consent shows an error", async ({ page, context }) => {
  await signInForTest(context);
  await page.goto("/account/health");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Health details");
  await page.getByLabel("Allergies").fill("Nuts");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Please tick the consent box" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request deletion of my data" })).toBeVisible();
  await noHorizontalScroll(page);
});

test("the confirmed page polls and then says You're in", async ({ page }) => {
  await page.goto("/book/e2e-retreat/confirmed?session=cs_e2e_confirmed");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You’re in, Layla.", { timeout: 10_000 });
  await expect(page.getByText("Health details & waiver")).toBeVisible();
  await expect(page.getByRole("link", { name: /Complete/ })).toHaveAttribute("href", "/account/health");
  await expect(page.getByText("Sara’s details")).toBeVisible();
  await expect(page.getByText("Pending")).toBeVisible();
  await noHorizontalScroll(page);
});

test("the confirmed page shows a confirming state while the payment is processed", async ({ page }) => {
  await page.goto("/book/e2e-retreat/confirmed?session=cs_e2e_unknown");
  await expect(page.getByRole("status")).toContainText("Confirming your booking");
});
