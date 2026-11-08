# Shilpa's link page

A dark, neon-purple Next.js 16 link-in-bio page. Instagram and email are public for everyone, including crawlers. Fanvue and its subscription bio line are returned only after server-side verification. These are the only three supported contact links; legacy phone, Twitter, Pinterest and extra-link settings are ignored.

This provides best-effort scraping resistance, not guaranteed exclusion of Meta, automated browsers, OSINT tools or human reviewers. A visitor who passes verification can copy the revealed content.

## Local development

Requires Node.js 20.9+ and npm.

```sh
npm install
npm run setup
npm run dev -- --port 3004
```

The current ignored `.env.local` uses `APP_ORIGIN=http://127.0.0.1:3004`. Open that exact origin. Setup preserves an existing `.env.local`; for a fresh checkout it generates signing/proxy secrets and fictional demo contacts. If you choose another port, update `APP_ORIGIN` to match.

Edit public name/bio in `src/profile.ts`. Contact values are runtime server variables:

- `CONTACT_INSTAGRAM_URL`: publicly rendered Instagram link.
- `CONTACT_EMAIL`: publicly rendered email link.
- `CONTACT_FANVUE_URL`: protected subscriber destination.
- `PRIVATE_BIO`: protected subscriber bio line, maximum 280 characters.

Public contact values intentionally appear in HTML/RSC/browser props. Never place the subscriber URL or subscriber copy in `src/profile.ts`, `public/`, metadata, client source, or `NEXT_PUBLIC_*` variables. The real local contacts are configured already. `ALLOW_LOCAL_DEMO=false` keeps the real subscriber destination locked until actual challenge credentials are set. Previously issued local demo sessions were invalidated when real contacts were introduced.

## ntfy notifications

The current local environment enables `https://ntfy.sh/shilpa-baja-linktree`. Subscribe to `shilpa-baja-linktree` in the ntfy app or web app. A clearly labelled setup notification was accepted by the live ntfy service during integration.

Runtime server configuration:

```dotenv
NTFY_ENABLED=true
NTFY_TOPIC=shilpa-baja-linktree
NTFY_TOKEN=
NTFY_INCLUDE_USER_AGENT_UNTIL=2026-11-15T12:02:05Z
NTFY_DAILY_LIMIT=240
```

`NTFY_TOKEN` is optional for an unreserved public topic. For an access-protected topic, use a token authorized to publish there. Neither the token nor topic is sent to browser code. Set `NTFY_ENABLED=false` to stop publishing.

### What is sent

- **Profile visit:** a timestamp and a User-Agent-based hint (recognized crawler/automation versus browser-like or unrecognized). Actual initial document requests, including recognized crawler requests, trigger notifications through Next.js `after()`. RSC fetches and known prefetch requests are excluded. This counts page requests, not unique people, and includes refreshes.
- **Temporary diagnostics:** until the UTC expiry above, visit notifications also include the request's User-Agent (control characters removed, up to 512 characters). Forwarding stops automatically at expiry. Blank, invalid or expired configuration disables it. This does not erase previously delivered messages or notifications. User-Agent strings can be spoofed; a normal-looking one cannot establish that a visitor is or is not Instagram.
- **Link tap:** the generic category Instagram, Email, or Subscriber link and a timestamp. No actual subscriber destination, subscriber copy, email address, visitor IP, query parameters, cookies or credentials are included. A subscriber tap report requires a valid verified session again.

Ordinary taps, keyboard link activation and middle clicks send a same-origin, keepalive request to `/api/events/link`. Navigation is not delayed while the server publishes. Copying a URL, opening through a context menu, disabled scripts, networking failure, abuse or notification-provider limits can lead to missed or forged reports. These are best-effort notifications, not audited analytics or proof of human activity.

Notifications are limited to 12 per minute per event category and hashed visitor/network grouping, 30 per minute globally and 240 per rolling 24-hour budget by default. If a client IP is unavailable, similar User-Agents share a grouping. The shared state adapter provides atomic rate limits with Redis, or process-local limits in development/explicit single-process mode. Failures skip notification delivery rather than preventing the page or link navigation. There is no durable delivery queue or automatic retry. The default daily budget leaves a small margin below ntfy.sh's documented anonymous 250-message daily limit; configure it for your actual plan if needed.

**Unreserved ntfy topics can be publicly readable and writable.** The requested topic is identifiable. Reserve/access-protect it for private diagnostics; use `NTFY_TOKEN` for publishing. Another publisher may otherwise inject messages. ntfy normally retains messages for about 12 hours, subscribers can retain them longer, and ntfy/hosting providers have their own processing policies. User-Agent forwarding is the expressly enabled temporary diagnostic exception to the minimal notification payload.

## Subscriber verification

1. `/` always server-renders public name/bio and public Instagram/email links. Identified crawlers do not receive the interactive subscriber section.
2. A browser requests a signed, five-minute challenge bound to User-Agent and trusted IP. A server-side nonce can be spent only once.
3. Browser observations include dimensions, viewport, pixel ratio, locale/timezone, visibility, cookie support, an automation flag, elapsed time and whether an interaction occurred. These are untrusted hints, not attestation. No invasive canvas fingerprint, GPS prompt or general browsing-history access is used.
4. Production requires a real Cloudflare Turnstile result checked with Siteverify, including hostname, action and challenge nonce. A client-supplied success flag is insufficient. Test keys and the local demo bypass are rejected in production.
5. A server-only heuristic score combines that challenge with request headers, trusted IP/coarse edge location/optional edge bot score, and this site's signed previous-success cookie. The default threshold of 75 is a heuristic, not a 75% probability. Reported automation, known crawlers and low trusted edge scores are denied regardless of other signals.
6. A successful visitor gets a short-lived HttpOnly/SameSite=Strict cookie (Secure with `__Host-` in production). Only `/api/contacts` can return the subscriber destination and private bio, after checking session, binding and crawler/network conditions again. Public links do not depend on this endpoint or on challenge configuration.

The subscriber section clears on tab hiding/restoration and after five minutes. Public links remain available. All profile and API responses are `private, no-store`, with CDN-specific no-store headers. `robots.txt` and `noindex` discourage cooperative indexing but are not access controls. The browser collector, challenge integration and network protocol are observable; scoring rules, secrets and ungranted subscriber data stay server-side.

## Production

The public profile works without Turnstile credentials. Subscriber access fails closed until configured.

1. Set the exact HTTPS `APP_ORIGIN` without a trailing slash. Keep a stable random `SESSION_SECRET` of at least 32 characters across replicas. Generate secrets with `openssl rand -hex 48`. Set the contact, private bio and ntfy runtime variables on your production host; `.env.local` is not deployed automatically.
2. Create a Managed Cloudflare Turnstile widget for the public hostname and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Production rejects test keys. Its interaction-only appearance requests extra interaction only when required by the provider.
3. Put a trusted proxy in front of Next.js. Set a separate random `PROXY_SHARED_SECRET` of at least 32 characters on both sides. Incoming network headers are trusted only with this secret. Strip/overwrite incoming `X-Cloak-*` headers; never forward them unchanged or log the secret.
   - `deploy/cloudflare-worker.ts` forwards Cloudflare's client IP/country/timezone and optional Bot Management scores. Route it on the public hostname and set `ORIGIN_URL` to the separate Next.js HTTPS origin. Store the proxy secret in Worker secrets. Numeric Bot Management scoring requires an eligible plan.
   - `deploy/nginx.conf.example` supports a VPS. Replace the proxy secret, configure TLS and bind Node to loopback. If behind another proxy, configure real-IP handling only for that provider's trusted ranges. Do not trust arbitrary `X-Forwarded-For`.
4. For serverless or replicas, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. For exactly one long-lived Node process, explicitly set `SINGLE_PROCESS_MEMORY=true` instead. Shared state is needed for distributed challenge consumption and notification/access rate limits.
5. Run `npm run build` and `npm start`. The provided start command binds to loopback. Managed hosts that require a public bind can use `next start --hostname 0.0.0.0 --port $PORT`, with origin access restricted to the trusted edge. Do not cache `/` or `/api/*`. Ensure your host supports Next.js `after()` and sufficient request duration for outbound notification requests.

Untrusted direct-origin requests cannot obtain subscriber access. Challenges and IP changes may also reject legitimate visitors, especially in restrictive in-app browsers. Previously published data, information on other services and copies by verified visitors cannot be protected by this page.

## Checks

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

The browser suite uses isolated Google Chrome with fictional contacts, notifications explicitly disabled, port 3104 and `.next-test` output. It can coexist with the normal development server. Unit tests mock ntfy, so automated checks do not publish visitor data or spam the live topic. Tests cover public visibility for crawler UAs, protected destination/bio separation, session expiry/tampering/replay, forged network headers, private tap authorization, same-origin reporting, actual browser tap events, provider failure and automatic UA diagnostic expiry. They do not certify exclusion of real Meta review infrastructure.

The design uses a centered Linktree-style layout, dark plum, neon violet, a circular initials avatar and stacked buttons. No real portrait was supplied. Design dials: variance 3 / motion 3 / density 3. The unused forest asset remains from the earlier theme ([photo source](https://unsplash.com/photos/hg5Tx6c_5nc)).

Sources: [ntfy publishing, topic access, caching and limits](https://docs.ntfy.sh/publish/), [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Cloudflare bot scores](https://developers.cloudflare.com/bots/concepts/bot-score/), [robots.txt limitations](https://developers.google.com/search/docs/crawling-indexing/robots/intro).
