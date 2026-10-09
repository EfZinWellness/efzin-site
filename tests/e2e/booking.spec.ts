import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import Stripe from "stripe";
import { stagingSkipReason } from "./staging";

/**
 * Full staging flow against the deployed preview, with Stripe TEST mode:
 * book with a guest via Stripe Checkout, sold out -> waitlist, cancel preview, admin check-in.
 *
 * Skipped unless E2E_STAGING_URL, STRIPE_SECRET_KEY (sk_test_ only), EFZIN_E2E_ADMIN_EMAIL,
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the STAGING project) are set. It never uses the local
 * dev server and refuses a live Stripe key. Run with `npm run test:e2e:staging` (see docs/launch-runbook.md).
 *
 * Also required: E2E_STAGING_SLUG (an experience that is on sale with spots left on staging).
 * Optional: E2E_STAGING_SOLDOUT_SLUG (an experience with no spots left, for the waitlist test).
 */
const skipReason = stagingSkipReason(process.env);
const BASE = process.env.E2E_STAGING_URL?.trim().replace(/\/$/, "") ?? "";
const SLUG = process.env.E2E_STAGING_SLUG?.trim() ?? "";
const SOLD_OUT_SLUG = process.env.E2E_STAGING_SOLDOUT_SLUG?.trim();

test.use({ baseURL: BASE || undefined, viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: "serial" });
test.skip(skipReason !== null, skipReason ?? "");
test.setTimeout(180_000);

const run = Date.now().toString(36);
// Resend's test address accepts "+label" variants, so no real inbox is ever emailed.
const resendTest = (label: string) => `delivered+${label}-${run}@resend.dev`;
const booker = { name: `E2E Booker ${run}`, email: resendTest("booker"), phone: "+971500000000" };
const guest = { name: `E2E Guest ${run}`, email: resendTest("guest") };

/** Signs a page in as `email` with a one-time link made by the Supabase admin API (staging project). */
async function signInAs(page: Page, email: string): Promise<void> {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const url = new URL("/account/auth/confirm", BASE);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "magiclink");
  await page.goto(url.toString());
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/account/);
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
  return context.newPage();
}

test("books with a guest through Stripe Checkout (test card 4242)", async ({ page }) => {
  await page.goto(`/book/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (await page.getByText(/Not currently available|Sold out/).first().isVisible().catch(() => false)) {
    throw new Error(`E2E_STAGING_SLUG "${SLUG}" is not on sale on staging (shows Not currently available / Sold out). Pick an experience that is on sale with spots left.`);
  }

  await page.getByRole("button", { name: /^Add one / }).first().click();
  await page.getByLabel("Your name").fill(booker.name);
  await page.getByLabel("Email", { exact: true }).fill(booker.email);
  await page.getByLabel("Phone").fill(booker.phone);
  await page.getByLabel("Guest 2 name").fill(guest.name);
  await page.getByLabel("Guest 2 email").fill(guest.email);
  await page.getByLabel(/I accept the cancellation policy/).check();
  await page.getByRole("button", { name: /Continue to payment/ }).click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  const billingName = page.locator("#billingName");
  if (await billingName.isVisible().catch(() => false)) await billingName.fill(booker.name);
  await page.locator(".SubmitButton, button[type=submit]").first().click();

  await page.waitForURL(new RegExp(`/book/${SLUG}/confirmed`), { timeout: 90_000 });
  // The webhook confirms the booking; the page polls until it does.
  await expect(page.getByText(/you.re booked in|confirmed/i).first()).toBeVisible({ timeout: 90_000 });

  // Stripe agrees: a customer exists for the booker (TEST mode).
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const customers = await stripe.customers.list({ email: booker.email, limit: 1 });
  expect(customers.data.length).toBe(1);
});

test("a sold-out experience offers the waitlist", async ({ page }) => {
  test.skip(!SOLD_OUT_SLUG, "Set E2E_STAGING_SOLDOUT_SLUG to an experience with no spots left to run this.");
  await page.goto(`/book/${SOLD_OUT_SLUG}`);
  await page.getByRole("link", { name: "Join the waitlist" }).click();
  await page.waitForURL(new RegExp(`/waitlist/${SOLD_OUT_SLUG}`));
  const form = page.getByTestId("waitlist-form");
  await form.getByLabel("Name").fill(`E2E Waiter ${run}`);
  await form.getByLabel("Email").fill(resendTest("waiter"));
  await form.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("status")).toContainText(/we.ll email you/i);
});

test("the booker sees the cancel preview in My Ef Zin (and does not confirm it)", async ({ browser }) => {
  const page = await newPage(browser);
  await signInAs(page, booker.email);
  await page.goto("/account");
  const link = page.locator('a[href^="/account/bookings/"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!.split("?")[0];

  await page.goto(`${href}?cancel=1`);
  const panel = page.getByTestId("cancel-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Confirm cancellation" }).first()).toBeVisible();

  // Preview only: go back and check the booking is still active.
  await panel.getByRole("link", { name: "Keep my booking" }).click();
  await expect(page.getByTestId("cancel-link")).toBeVisible();
  await page.context().close();
});

test("an admin checks the guest in", async ({ browser }) => {
  const page = await newPage(browser);
  await signInAs(page, process.env.EFZIN_E2E_ADMIN_EMAIL!.trim());
  await page.goto(`/admin/experiences/${SLUG}`);
  const row = page.getByRole("row").filter({ hasText: guest.name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Check in" }).click();
  await expect(row.getByRole("button", { name: /Checked in/ })).toBeVisible();
  await page.context().close();
});
