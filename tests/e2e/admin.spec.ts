import { test, expect, type BrowserContext } from "@playwright/test";

test.use({ viewport: { width: 360, height: 800 } });
// The dev server compiles each admin route on first visit.
test.setTimeout(120_000);

/** Dev-only seam: signs in as EFZIN_TEST_AUTH_EMAIL (e2e@example.com, who is not on ADMIN_EMAILS). */
async function signInForTest(context: BrowserContext) {
  await context.addCookies([{ name: "efzin_test_auth", value: "1", url: "http://localhost:3000" }]);
}

const PAGES = ["/admin", "/admin/people", "/admin/requests", "/admin/gift-cards", "/admin/payments", "/admin/experiences/anything"];

test("signed-out visitors get a 404 on every admin page, never a redirect", async ({ page }) => {
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    expect(new URL(page.url()).pathname, path).toBe(path);
  }
});

test("a signed-in member who is not an admin gets a 404", async ({ page, context }) => {
  await signInForTest(context);
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("CSV export answers 404 to a non-admin and to a signed-out visitor", async ({ page, context, request }) => {
  const anon = await request.get("/admin/export/people");
  expect(anon.status()).toBe(404);
  await signInForTest(context);
  const res = await page.request.get("/admin/export/people");
  expect(res.status()).toBe(404);
});
