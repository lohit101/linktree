import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { isDocumentVisit, notifyLink, notifyVisit, publishNotification, visitMessage } from "../src/lib/server/notifications";
import { POST as linkEvent } from "../src/app/api/events/link/route";

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
const delivered: { url: string; body: string; headers: Headers }[] = [];
before(() => {
  Object.assign(process.env, {
    NODE_ENV: "test", NTFY_ENABLED: "true", NTFY_TOPIC: "isolated-unit-topic", NTFY_TOKEN: "unit-test-token",
    SESSION_SECRET: "notification-unit-signing-secret-at-least-32-characters",
    PROXY_SHARED_SECRET: "", APP_ORIGIN: "http://127.0.0.1:3000", NTFY_DAILY_LIMIT: "240",
    NTFY_INCLUDE_USER_AGENT_UNTIL: "2030-01-01T00:00:00.000Z",
  });
  globalThis.fetch = (async (url, options) => {
    delivered.push({ url: String(url), body: String(options?.body), headers: new Headers(options?.headers) });
    return Response.json({ id: "mock-delivery" });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = savedFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("UA diagnostics expire automatically and distinguish hints from proof", () => {
  const headers = new Headers({ "user-agent": "meta-externalagent/1.1", "x-forwarded-for": "1.2.3.4" });
  const beforeExpiry = visitMessage(headers, new Date("2029-12-31"));
  assert.ok(beforeExpiry.includes("User-Agent: meta-externalagent/1.1"));
  assert.ok(beforeExpiry.includes("not proof of source"));
  assert.ok(!beforeExpiry.includes("1.2.3.4"));
  assert.ok(!visitMessage(headers, new Date("2030-01-01")).includes("User-Agent:"));
});

test("server publisher uses only configured topic and optional bearer token; provider failure is contained", async () => {
  assert.equal(await publishNotification("Test", "Safe diagnostic message"), true);
  const request = delivered.at(-1)!;
  assert.equal(request.url, "https://ntfy.sh/isolated-unit-topic");
  assert.equal(request.headers.get("authorization"), "Bearer unit-test-token");
  assert.ok(!request.body.includes("unit-test-token"));
  globalThis.fetch = (async () => new Response("Unavailable", { status: 503 })) as typeof fetch;
  try { assert.equal(await publishNotification("Test", "Safe"), false); }
  finally {
    globalThis.fetch = (async (url, options) => {
      delivered.push({ url: String(url), body: String(options?.body), headers: new Headers(options?.headers) });
      return Response.json({ id: "mock-delivery" });
    }) as typeof fetch;
  }
});

test("visits include crawler requests but exclude RSC and prefetch; taps omit destination details", async () => {
  assert.equal(isDocumentVisit(new Headers({ rsc: "1" })), false);
  assert.equal(isDocumentVisit(new Headers({ "sec-purpose": "prefetch" })), false);
  assert.equal(await notifyVisit(new Headers({ "user-agent": "meta-externalfetcher/1.1" })), true);
  assert.ok(delivered.at(-1)!.body.includes("meta-externalfetcher/1.1"));
  assert.equal(await notifyLink(new Headers({ "user-agent": "unit-browser" }), "subscription"), true);
  assert.ok(delivered.at(-1)!.body.includes("Subscriber link"));
  assert.ok(!/fanvue|https:|@/.test(delivered.at(-1)!.body));
});

test("public tap reports require same origin; private tap reports also require a verified session", async () => {
  const makeRequest = (link: string, origin = "http://127.0.0.1:3000") => new NextRequest("http://127.0.0.1:3000/api/events/link", {
    method: "POST", body: JSON.stringify({ link }), headers: {
      origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "user-agent": "Mozilla/5.0 unit-browser",
    },
  });
  assert.equal((await linkEvent(makeRequest("email"))).status, 200);
  assert.equal((await linkEvent(makeRequest("instagram"))).status, 200);
  assert.equal((await linkEvent(makeRequest("email", "https://attacker.example"))).status, 403);
  assert.equal((await linkEvent(makeRequest("arbitrary"))).status, 400);
  assert.equal((await linkEvent(makeRequest("subscription"))).status, 401);
});
