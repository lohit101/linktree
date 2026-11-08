import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { getAccessConfig, getPrivateContacts, getPublicContacts, ProtectionError } from "../src/lib/server/config";
import { cookieName, makeBinding, randomId, readToken, signToken } from "../src/lib/server/crypto";
import { checkOrigin, getNetwork, isKnownCrawler, readSmallJson, type NetworkContext } from "../src/lib/server/request";
import { scoreVisitor } from "../src/lib/server/score";
import { consumeChallenge, rateLimit } from "../src/lib/server/state";
import { validateWork } from "../src/lib/server/work";
import { solveBrowserWork } from "../src/lib/work";
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
    PROXY_SHARED_SECRET: proxySecret, HUMANITY_THRESHOLD: "75", CONTACT_EMAIL: "private-test@example.com", CONTACT_PHONE: "+1 202 555 0178",
    CONTACT_TWITTER_URL: "https://x.com/private_test", CONTACT_PINTEREST_URL: "", CONTACT_EXTRA_LINKS: "",
    CONTACT_INSTAGRAM_URL: "", CONTACT_FANVUE_URL: "https://www.fanvue.com/private_fixture", NTFY_ENABLED: "false",
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

test("Vercel network trust requires the server runtime; client-supplied platform and bot-score headers do not establish trust", () => {
  const mode = process.env.NODE_ENV;
  const vercel = process.env.VERCEL;
  const values = new Headers({
    "x-vercel-forwarded-for": "203.0.113.10", "x-vercel-ip-country": "IN",
    "x-vercel-ip-timezone": "Asia/Kolkata", "x-cloak-bot-score": "99", "x-cloak-verified-bot": "true",
  });
  assert.equal(getNetwork(values, { proxySecret: "" }).trusted, false);
  try {
    Object.assign(process.env, { NODE_ENV: "production", VERCEL: "1" });
    assert.deepEqual(getNetwork(values, { proxySecret: "" }), {
      ip: "203.0.113.10", country: "IN", timezone: "Asia/Kolkata", trusted: true, botScore: null, verifiedBot: false,
    });
    values.set("x-vercel-forwarded-for", "203.0.113.10, 1.1.1.1");
    assert.equal(getNetwork(values, { proxySecret: "" }).trusted, false);
  } finally {
    Object.assign(process.env, { NODE_ENV: mode });
    if (vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = vercel;
  }
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

test("process-local replay cache rejects repeat submissions and expired challenges", () => {
  const nonce = randomId();
  assert.equal(consumeChallenge(nonce, Date.now() + 120000), true);
  assert.equal(consumeChallenge(nonce, Date.now() + 120000), false);
  assert.equal(consumeChallenge(randomId(), Date.now() - 1), false);
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

function solve(nonce: string) {
  for (let counter = 0; counter <= 1048575; counter++) if (validateWork(nonce, counter)) return counter;
  throw new Error("No work solution");
}

function agedChallengeCookie(nonce: string, ip: string | null = null) {
  const binding = makeBinding(secret, ua, ip);
  const token = signToken({ secret }, "challenge", binding, nonce, Date.now() - 1500);
  return `${cookieName(process.env.NODE_ENV === "production", "challenge")}=${token}`;
}

test("browser work solver matches the server algorithm without contacting any provider", async () => {
  const nonce = randomId();
  const counter = await solveBrowserWork(nonce, new AbortController().signal);
  assert.equal(validateWork(nonce, counter), true);
  assert.equal(validateWork(nonce, -1), false);
  assert.equal(validateWork(nonce, 1048576), false);
  assert.equal(validateWork("not-a-nonce", counter), false);
});

test("protected routes require a complete valid flow and reject replay, copied crawler cookies, and CSRF", async () => {
  const unauthenticated = await contacts(request("/api/contacts"));
  assert.equal(unauthenticated.status, 401);
  assert.ok(!(await unauthenticated.text()).includes("private-test@example.com"));
  const started = await start(request("/api/access/start", {}));
  assert.equal(started.status, 200);
  const challenge = await started.json();
  const rawChallengeCookie = agedChallengeCookie(challenge.nonce);
  const body = { nonce: challenge.nonce, counter: solve(challenge.nonce), website: "", signals };
  const verified = await verify(request("/api/access/verify", body, { cookie: rawChallengeCookie }));
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
  assert.equal((await verify(request("/api/access/verify", body, { cookie: rawChallengeCookie }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: rawCookie, "user-agent": "facebookexternalhit/1.1" }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: rawCookie, origin: "https://attacker.example" }))).status, 403);
  assert.equal((await contacts(request("/api/contacts", undefined, { cookie: "cloak-session=forged" }))).status, 401);
});

test("the code-only verifier rejects automation and missing or invalid work", async () => {
  const started = await start(request("/api/access/start", {}));
  const challenge = await started.json();
  const cookie = agedChallengeCookie(challenge.nonce);
  const valid = solve(challenge.nonce);
  let invalid = 0;
  while (validateWork(challenge.nonce, invalid)) invalid++;
  const make = (counter: number, webdriver: boolean) => request("/api/access/verify", {
    nonce: challenge.nonce, counter, website: "", signals: { ...signals, webdriver },
  }, { cookie });
  assert.equal((await verify(make(valid, true))).status, 403);
  assert.equal((await verify(make(invalid, false))).status, 403);
  assert.equal((await verify(request("/api/access/verify", { nonce: challenge.nonce, website: "", signals }, { cookie }))).status, 400);
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

test("production runs without services; only signing configuration and an HTTPS origin are required", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", APP_ORIGIN: "https://profile.example.com", PROXY_SHARED_SECRET: "" });
    assert.equal(getAccessConfig().origin.origin, "https://profile.example.com");
    process.env.APP_ORIGIN = origin;
    assert.throws(getAccessConfig, ProtectionError);
    process.env.VERCEL = "1";
    assert.equal(getAccessConfig(new Request("https://live.vercel.app/api/access/start")).origin.origin, "https://live.vercel.app");
    process.env.SESSION_SECRET = "GENERATE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS";
    assert.throws(() => getAccessConfig(new Request("https://live.vercel.app")), ProtectionError);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("a Vercel production flow accepts signed stateless challenges without a shared database", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", VERCEL: "1", APP_ORIGIN: origin, PROXY_SHARED_SECRET: "" });
    const live = "https://live.vercel.app";
    const base = new Headers(headers);
    base.set("origin", live);
    base.set("x-vercel-forwarded-for", "203.0.113.10");
    const started = await start(new NextRequest(`${live}/api/access/start`, { method: "POST", headers: base, body: "{}" }));
    assert.equal(started.status, 200);
    const challenge = await started.json();
    base.set("cookie", agedChallengeCookie(challenge.nonce, "203.0.113.10"));
    const verified = await verify(new NextRequest(`${live}/api/access/verify`, {
      method: "POST", headers: base, body: JSON.stringify({ nonce: challenge.nonce, counter: solve(challenge.nonce), website: "", signals }),
    }));
    assert.equal(verified.status, 200);
    const session = verified.cookies.get("__Host-cloak-session")!;
    assert.ok(session);
    base.set("cookie", `${session.name}=${session.value}`);
    const opened = await contacts(new NextRequest(`${live}/api/contacts`, { headers: base }));
    assert.equal(opened.status, 200);
    assert.ok((await opened.text()).includes("https://www.fanvue.com/private_fixture"));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
