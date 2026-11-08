import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { getAccessConfig, getPrivateContacts, getPublicContacts, ProtectionError } from "../src/lib/server/config";
import { cookieName, makeBinding, randomId, readToken, signToken } from "../src/lib/server/crypto";
import { checkOrigin, getNetwork, isKnownCrawler, readSmallJson, type NetworkContext } from "../src/lib/server/request";
import { scoreVisitor } from "../src/lib/server/score";
import { consumeChallenge, rateLimit, reserveChallenge } from "../src/lib/server/state";
import { validateChallenge } from "../src/lib/server/turnstile";
import type { BrowserSignals } from "../src/lib/contracts";
import { POST as start } from "../src/app/api/access/start/route";
import { POST as verify } from "../src/app/api/access/verify/route";
import { GET as contacts } from "../src/app/api/contacts/route";

const savedEnv = { ...process.env };
const secret = "test-signing-key-with-more-than-32-characters";
const proxySecret = "test-proxy-key-separate-from-signing-key-32chars";
const origin = "http://127.0.0.1:3000";
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const headers = new Headers({
  "user-agent": ua, "origin": origin, "accept-language": "en-US,en;q=0.9",
  "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "content-type": "application/json",
});
const network: NetworkContext = { ip: null, country: null, timezone: null, botScore: null, verifiedBot: false, trusted: false };
const signals: BrowserSignals = {
  screen: { width: 1440, height: 900, availableWidth: 1440, availableHeight: 860, pixelRatio: 2 },
  viewport: { width: 1200, height: 800 }, timezone: "Asia/Kolkata", timezoneOffset: -330,
  language: "en-US", languages: ["en-US", "en"], webdriver: false, cookiesEnabled: true,
  visible: true, touchPoints: 0, elapsedMs: 2000, interacted: false,
};

before(() => {
  Object.assign(process.env, { NODE_ENV: "test", APP_ORIGIN: origin, SESSION_SECRET: secret,
    PROXY_SHARED_SECRET: proxySecret, ALLOW_LOCAL_DEMO: "true", HUMANITY_THRESHOLD: "75",
    TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "", UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "", CONTACT_EMAIL: "private-test@example.com", CONTACT_PHONE: "+1 202 555 0178",
    CONTACT_TWITTER_URL: "https://x.com/private_test", CONTACT_PINTEREST_URL: "", CONTACT_EXTRA_LINKS: "",
    CONTACT_INSTAGRAM_URL: "", SINGLE_PROCESS_MEMORY: "false", CONTACT_FANVUE_URL: "https://www.fanvue.com/private_fixture", NTFY_ENABLED: "false",
    PRIVATE_BIO: "Private subscriber bio fixture." });
});
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

function request(path: string, body?: unknown, extra?: Record<string, string>) {
  const values = new Headers(headers);
  for (const [key, value] of Object.entries(extra ?? {})) values.set(key, value);
  return new NextRequest(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: values,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function scored(overrides: Partial<Parameters<typeof scoreVisitor>[0]> = {}) {
  return scoreVisitor({ signals, headers, network, challengePassed: true, returningVisitor: false,
    serverElapsedMs: 2000, honeypot: "", ...overrides });
}

test("signed tokens reject tampering, expiry, wrong scope, and changed device/network", () => {
  const binding = makeBinding(secret, ua, "203.0.113.10");
  const config = { secret };
  const now = Date.now();
  const token = signToken(config, "session", binding, randomId(), now);
  assert.ok(readToken(config, token, "session", binding, now));
  assert.equal(readToken(config, token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), "session", binding), null);
  assert.equal(readToken(config, token, "visit", binding), null);
  assert.equal(readToken(config, token, "session", makeBinding(secret, "different-browser", "203.0.113.10")), null);
  assert.equal(readToken(config, token, "session", makeBinding(secret, ua, "203.0.113.11")), null);
  assert.equal(readToken(config, token, "session", binding, now + 600001), null);
  assert.equal(readToken({ secret: "wrong-secret" }, token, "session", binding), null);
  assert.ok(cookieName(true, "session").startsWith("__Host-"));
});

test("forged network headers do not establish trusted IP, geo or bot scores", () => {
  const forged = new Headers({ "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "1.1.1.1",
    "x-cloak-client-ip": "1.1.1.1", "x-cloak-bot-score": "99", "x-cloak-country": "IN",
    "x-cloak-proxy-secret": "guess" });
  assert.deepEqual(getNetwork(forged, { proxySecret }), network);
  forged.set("x-cloak-proxy-secret", proxySecret);
  forged.set("x-cloak-timezone", "Asia/Kolkata");
  assert.deepEqual(getNetwork(forged, { proxySecret }), { ip: "1.1.1.1", country: "IN", timezone: "Asia/Kolkata", botScore: 99, verifiedBot: false, trusted: true });
  forged.set("x-cloak-client-ip", "1.1.1.1, 8.8.8.8");
  forged.set("x-cloak-bot-score", "100");
  assert.equal(getNetwork(forged, { proxySecret }).ip, null);
  assert.equal(getNetwork(forged, { proxySecret }).botScore, null);
});

test("Meta crawlers are identified; an ordinary Instagram in-app browser is not blanket-blocked", () => {
  for (const crawler of ["facebookexternalhit/1.1", "Facebot", "meta-externalagent/1.1", "meta-externalfetcher/1.1", "meta-webindexer/1.1", "Googlebot/2.1", "curl/8.0"]) {
    assert.equal(isKnownCrawler(crawler), true, crawler);
  }
  assert.equal(isKnownCrawler(`${ua} Instagram 340.0.0.0`), false);
  assert.equal(isKnownCrawler(""), true);
});

test("no screen, IP, location, or history score can replace the server challenge", () => {
  assert.equal(scored({ challengePassed: false, returningVisitor: true,
    network: { ...network, trusted: true, ip: "1.1.1.1", country: "IN", timezone: "Asia/Kolkata", botScore: 99 } }).denied, true);
  assert.equal(scored({ signals: { ...signals, webdriver: true } }).denied, true);
  assert.equal(scored({ honeypot: "https://spam.example" }).denied, true);
  assert.equal(scored({ network: { ...network, botScore: 5 } }).denied, true);
  assert.equal(scored({ network: { ...network, botScore: 99, verifiedBot: true } }).denied, true);
  assert.equal(scored({ headers: new Headers({ "user-agent": "facebookexternalhit/1.1" }) }).denied, true);
});

test("plausible first-time visitors pass without GPS, tracking history, mouse gestures or geo matches", () => {
  const result = scored();
  assert.equal(result.denied, false);
  assert.ok(result.score >= 75);
  assert.ok(scored({ network: { ...network, timezone: "Europe/London" } }).score >= 75);
  assert.ok(scored({ signals: { ...signals, screen: { ...signals.screen, width: 390, height: 844, availableWidth: 390, availableHeight: 844 }, viewport: { width: 390, height: 720 }, touchPoints: 5 } }).score >= 75);
  assert.ok(scored({ signals: { ...signals, viewport: { width: 720, height: 800 } } }).score >= 75);
});

test("server elapsed time is checked independently of client-reported dwell time", () => {
  const fast = scored({ serverElapsedMs: 5 });
  const slow = scored({ serverElapsedMs: 2000 });
  assert.equal(slow.score - fast.score, 3);
});

test("single-use nonce consumption is atomic and expired nonces fail", async () => {
  const nonce = randomId();
  await reserveChallenge(nonce);
  const consumed = await Promise.all([consumeChallenge(nonce), consumeChallenge(nonce)]);
  assert.equal(consumed.filter(value => value !== null).length, 1);
  const old = randomId();
  await reserveChallenge(old, Date.now() - 301000);
  assert.equal(await consumeChallenge(old), null);
});

test("rate limits cap repeated attempts", async () => {
  const key = randomId();
  await rateLimit(key, 2, 600);
  await rateLimit(key, 2, 600);
  await assert.rejects(rateLimit(key, 2, 600), (error: unknown) => error instanceof ProtectionError && error.status === 429);
});

test("cross-origin requests and oversized or malformed bodies are rejected", async () => {
  const config = getAccessConfig();
  assert.throws(() => checkOrigin(request("/api/access/start", {}, { origin: "https://attacker.example" }), config));
  assert.throws(() => checkOrigin(request("/api/access/start", {}, { "sec-fetch-site": "cross-site" }), config));
  const large = new Request(`${origin}/api/access/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(15000) }) });
  await assert.rejects(readSmallJson(large), (error: unknown) => error instanceof ProtectionError && error.status === 413);
  await assert.rejects(readSmallJson(new Request(origin, { method: "POST", body: "invalid", headers: { "content-type": "application/json" } })), ProtectionError);
});

test("Turnstile verification binds success to hostname, action, and nonce; provider failures fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const config = { ...getAccessConfig(), challengeSecret: "provider-secret" };
  const nonce = randomId();
  let result: Record<string, unknown> = { success: true, hostname: "127.0.0.1", action: "contact_access", cdata: nonce };
  try {
    globalThis.fetch = (async (_url, options) => {
      const sent = options?.body as URLSearchParams;
      assert.equal(sent.get("secret"), "provider-secret");
      assert.equal(sent.get("remoteip"), "1.1.1.1");
      return Response.json(result);
    }) as typeof fetch;
    assert.equal(await validateChallenge(config, "token", nonce, "1.1.1.1"), true);
    for (const changed of [{ hostname: "attacker.example" }, { action: "different" }, { cdata: "wrong" }, { success: false }]) {
      result = { success: true, hostname: "127.0.0.1", action: "contact_access", cdata: nonce, ...changed };
      assert.equal(await validateChallenge(config, "token", nonce, "1.1.1.1"), false);
    }
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await assert.rejects(validateChallenge(config, "token", nonce, null), ProtectionError);
  } finally { globalThis.fetch = originalFetch; }
});

test("protected routes require a complete valid flow and reject replay, copied crawler cookies, and CSRF", async () => {
  const unauthenticated = await contacts(request("/api/contacts"));
  assert.equal(unauthenticated.status, 401);
  assert.ok(!(await unauthenticated.text()).includes("private-test@example.com"));
  const started = await start(request("/api/access/start", {}));
  assert.equal(started.status, 200);
  const challenge = await started.json();
  const cookie = started.cookies.get("cloak-challenge")!;
  await reserveChallenge(challenge.nonce, Date.now() - 1500);
  const body = { nonce: challenge.nonce, token: "", website: "", signals };
  const verified = await verify(request("/api/access/verify", body, { cookie: `${cookie.name}=${cookie.value}` }));
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { ok: true });
  const session = verified.cookies.get("cloak-session")!;
  const rawCookie = `${session.name}=${session.value}`;
  const opened = await contacts(request("/api/contacts", undefined, { cookie: rawCookie }));
  assert.equal(opened.status, 200);
  assert.ok(opened.headers.get("cache-control")?.includes("no-store"));
  const privateData = await opened.json();
  assert.ok(JSON.stringify(privateData).includes("https://www.fanvue.com/private_fixture"));
  assert.ok(!JSON.stringify(privateData).includes("private-test@example.com"));
  assert.equal(privateData.bio, "Private subscriber bio fixture.");
  assert.ok(verified.headers.get("set-cookie")?.includes("HttpOnly"));
  assert.ok(verified.headers.get("set-cookie")?.includes("SameSite=strict"));
  assert.equal((await verify(request("/api/access/verify", body, { cookie: `${cookie.name}=${cookie.value}` }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: rawCookie, "user-agent": "facebookexternalhit/1.1" }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: rawCookie, origin: "https://attacker.example" }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: "cloak-session=forged" }))).status, 401);
});

test("automation is rejected even by the local demo route", async () => {
  const started = await start(request("/api/access/start", {}));
  const challenge = await started.json();
  const cookie = started.cookies.get("cloak-challenge")!;
  const denied = await verify(request("/api/access/verify", { nonce: challenge.nonce, token: "", website: "", signals: { ...signals, webdriver: true } }, { cookie: `${cookie.name}=${cookie.value}` }));
  assert.equal(denied.status, 403);
});

test("only public Instagram/email and private subscriber links are supported; invalid destinations fail closed", () => {
  assert.deepEqual(getPublicContacts().map(contact => contact.kind), ["email"]);
  assert.deepEqual(getPrivateContacts().map(contact => contact.kind), ["subscription"]);
  const previous = process.env.CONTACT_FANVUE_URL;
  try {
    process.env.CONTACT_FANVUE_URL = "javascript:alert(1)";
    assert.throws(getPrivateContacts, ProtectionError);
    process.env.CONTACT_FANVUE_URL = "https://attacker.example/fake";
    assert.throws(getPrivateContacts, ProtectionError);
  } finally { process.env.CONTACT_FANVUE_URL = previous; }
});

test("production cannot enable the local bypass and stays closed without real keys, origin and state configuration", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", ALLOW_LOCAL_DEMO: "true" });
    assert.throws(getAccessConfig, ProtectionError);
    Object.assign(process.env, { APP_ORIGIN: "https://profile.example.com", TURNSTILE_SITE_KEY: "real-site-key", TURNSTILE_SECRET_KEY: "real-secret-key" });
    assert.throws(getAccessConfig, ProtectionError); // Shared state missing.
    process.env.SINGLE_PROCESS_MEMORY = "true";
    assert.equal(getAccessConfig().localDemo, false);
    process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    assert.throws(getAccessConfig, ProtectionError);
    process.env.TURNSTILE_SITE_KEY = "real-site-key";
    process.env.SESSION_SECRET = "GENERATE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS";
    assert.throws(getAccessConfig, ProtectionError);
  } finally { Object.assign(process.env, previous); }
});
