import { expect, test } from "@playwright/test";

// Deterministic local simulation only. This does not certify real-world human detection.
async function simulateVisitor(page: import("@playwright/test").Page) {
  await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
}

test("public HTML and Meta crawler responses contain no private contact data", async ({ request }) => {
  for (const agent of ["facebookexternalhit/1.1", "meta-externalagent/1.1", "meta-externalfetcher/1.1"]) {
    const response = await request.get("/", { headers: { "user-agent": agent } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("A bit about me");
    expect(html).not.toContain('id="connect-heading"');
    expect(html).toContain("e2e-only@example.com");
    expect(html).toContain("https://www.instagram.com/e2e_fixture/");
    expect(html).not.toContain("555 0186");
    expect(html).not.toContain("https://www.fanvue.com/e2e_fixture");
    expect(html).not.toContain("Subscribe for exclusive fixture content.");
    expect(html).not.toContain("fanvue.com");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  }
  const normalHtml = await (await request.get("/")).text();
  expect(normalHtml).toContain("e2e-only@example.com");
  expect(normalHtml).not.toContain("https://www.fanvue.com/e2e_fixture");
  expect(normalHtml).not.toContain("Subscribe for exclusive fixture content.");
  expect(normalHtml).not.toContain("fanvue.com");
});

test("direct, forged-cookie, forged-network and cross-origin access fail closed", async ({ request }) => {
  const direct = await request.get("/api/contacts");
  expect(direct.status()).toBe(401);
  expect(await direct.text()).not.toContain("e2e-only@example.com");
  expect((await request.get("/api/contacts", { headers: { cookie: "cloak-session=fake", "x-cloak-bot-score": "99", "x-cloak-client-ip": "1.1.1.1" } })).status()).toBe(401);
  expect((await request.post("/api/access/start", { headers: { origin: "https://attacker.example" }, data: {} })).status()).toBe(403);
  expect((await request.post("/api/access/start", { data: {} })).status()).toBe(403);
  expect((await request.get("/api/contacts", { headers: { "user-agent": "facebookexternalhit/1.1" } })).status()).toBe(403);
});

test("simulated local visitor receives links, can hide them, and can reopen them", async ({ page }, testInfo) => {
  await simulateVisitor(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const email = page.getByRole("link", { name: "Email me e2e-only@example.com" });
  const portrait = page.getByRole("img", { name: "Shilpa Bajaj's profile picture" });
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute("href", "mailto:e2e-only@example.com");
  await expect(page.getByRole("link", { name: /Give me a call|Twitter|Pinterest/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toHaveAttribute("href", "https://www.fanvue.com/e2e_fixture");
  await expect(page.getByText("Subscribe for exclusive fixture content.", { exact: true })).toBeVisible();
  for (const [name, kind] of [[/Instagram/, "instagram"], [/My Fanvue/, "subscription"]] as const) {
    const link = page.getByRole("link", { name });
    await link.evaluate(element => element.addEventListener("click", event => event.preventDefault()));
    const report = page.waitForRequest(request => request.url().endsWith("/api/events/link"));
    await link.click();
    expect((await report).postDataJSON()).toEqual({ link: kind });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("profile.png"), fullPage: true });

  const ended = page.waitForResponse(response => response.url().endsWith("/api/access/end"));
  await page.getByRole("button", { name: "Hide links" }).click();
  await ended;
  await expect(email).toBeVisible();
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toHaveCount(0);
  await expect(page.getByText("Subscribe for exclusive fixture content.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View my links" }).click();
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toBeVisible();
});

test("an automation flag is rejected and the visitor can retry without data exposure", async ({ page }) => {
  // The isolated browser's genuine navigator.webdriver flag stays true in this test.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Email me/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Email me/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toHaveCount(0);
});

test("a copied valid session cannot be used by a Meta crawler", async ({ page, request }) => {
  await simulateVisitor(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /My Fanvue/ })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find(cookie => cookie.name === "cloak-session")!;
  expect(session).toBeTruthy();
  const denied = await request.get("/api/contacts", { headers: { "user-agent": "meta-externalfetcher/1.1", cookie: `${session.name}=${session.value}` } });
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain("e2e-only@example.com");
});
