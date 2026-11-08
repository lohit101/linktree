import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:3104";
const desktopAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: origin,
    channel: "chrome",
    userAgent: desktopAgent,
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } },
  ],
  webServer: {
    command: "npm run dev -- --port 3104",
    url: origin,
    timeout: 60000,
    reuseExistingServer: false,
    env: {
      CLOAK_TEST_OUTPUT: "true", NTFY_ENABLED: "false",
      APP_ORIGIN: origin,
      SESSION_SECRET: "isolated-e2e-session-secret-with-at-least-32-characters",
      PROXY_SHARED_SECRET: "isolated-e2e-proxy-secret-separate-at-least-32-characters",
      ALLOW_LOCAL_DEMO: "true", HUMANITY_THRESHOLD: "75",
      TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "",
      UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "",
      CONTACT_EMAIL: "e2e-only@example.com", CONTACT_PHONE: "+1 202 555 0186",
      CONTACT_TWITTER_URL: "https://x.com/e2e_fixture", CONTACT_PINTEREST_URL: "https://www.pinterest.com/e2e_fixture/",
      CONTACT_INSTAGRAM_URL: "https://www.instagram.com/e2e_fixture/", CONTACT_EXTRA_LINKS: "",
      CONTACT_FANVUE_URL: "https://www.fanvue.com/e2e_fixture",
      PRIVATE_BIO: "Subscribe for exclusive fixture content.",
    },
  },
});
