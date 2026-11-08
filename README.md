# Shilpa's link page

A dark, neon-purple Next.js link-in-bio page. Instagram and email are public. The subscriber link and subscription bio appear only after a **code-only browser check**. No verification-provider account, database or external anti-bot script is required. Existing optional ntfy notifications remain supported.

**This is basic scraping resistance, not proof of humanity.** An automated browser can imitate the signals, perform the work and receive the same content as a person. It does not guarantee exclusion of Instagram's review systems, advanced crawlers or human reviewers. Revealed links can be copied.

## Run

```sh
npm install
npm run setup
npm run dev -- --port 3004
```

The current `.env.local` uses `http://127.0.0.1:3004`. For a fresh checkout setup generates an ignored `.env.local` with a signing secret and fictional public contact data; it preserves an existing file. Match `APP_ORIGIN` to your local URL if you choose another port. There is no demo bypass: local and production run the same browser-work/scoring flow.

Public name/bio live in `src/profile.ts`. The Instagram photo is a local snapshot at `public/profile.jpg`, with no image request to Instagram. To refresh it, replace the file.

## Configuration

Only your existing server signing secret and contact values are needed:

- `SESSION_SECRET`: a stable random secret of at least 32 characters, identical on all instances. Setup generates it; production can use the one already copied to the host. Keep it out of Git and `NEXT_PUBLIC_*` variables.
- `APP_ORIGIN`: the exact local/self-hosted origin. **On Vercel the routed HTTPS request origin is derived automatically**, so a copied localhost value cannot block production verification or tap reports.
- `CONTACT_INSTAGRAM_URL`, `CONTACT_EMAIL`: intentionally public links, including in initial HTML/RSC/browser props.
- `CONTACT_FANVUE_URL`, `PRIVATE_BIO`: server-only subscriber destination and optional verified-only sentence. Never put these in public source, metadata, image assets or public environment variables.
- `HUMANITY_THRESHOLD`: optional heuristic threshold, default 75. This is not a probability.
- `PROXY_SHARED_SECRET`: optional for an authenticated client-IP adapter on other hosts. It is not required to run the app. Native Vercel IP/country/timezone headers work automatically in the production Vercel runtime; arbitrary forwarded headers are ignored elsewhere.

Only Instagram, email and the subscriber link are supported. Legacy phone/Twitter/Pinterest/extra-link settings do not add anything to the page. Old verification-provider/database/bypass settings are ignored and can be deleted from the hosting environment.

See [Vercel deployment notes](deploy/VERCEL.md). `.env.local` is not uploaded by Git; the private contact values and existing signing secret still need to be present in your host's environment. No new service credentials are required.

## Browser checks

1. `/` renders the public bio, photo, Instagram and email. Recognized crawler User-Agents receive no interactive subscriber section. User-Agent identification is only a weak hint; unknown bots may look normal.
2. The browser obtains a random nonce and an HttpOnly signed cookie containing the nonce, browser/IP binding, issue time and a two-minute expiry. This challenge is **stateless**: another serverless replica can validate it without querying a database.
3. Using the browser's built-in Web Crypto, the browser finds a counter for `SHA-256(nonce + ':' + counter)` beginning with three zero hex digits. Expected work is about 4,096 hashes in small asynchronous batches, capped at 12 seconds. This proves only computation, not humanity. HTTPS (or localhost) and a modern browser are required.
4. The browser submits the solution plus dimensions, viewport/pixel ratio, locale/timezone, visibility, cookie support, an automation flag, dwell time and an interaction hint. These observations are forgeable. No general browsing-history access, GPS prompt, canvas/WebGL fingerprint or device identity database is used.
5. The server validates signature, scope, expiry, binding, nonce, SHA-256 work and minimum elapsed time, then applies its heuristic score. Known crawler UAs, reported automation, honeypot input, invisible/zero-size displays and low authenticated edge scores are rejected. Missing optional network metadata receives no bonus; it is not a configuration error.
6. On success a 10-minute HttpOnly/SameSite=Strict cookie is issued (Secure and `__Host-` prefixed in production). `/api/contacts` checks this cookie and crawler/network conditions again before returning subscriber data. Scores and decision rules stay server-side. The public work protocol and signal collector are observable.

The subscriber UI clears on tab hiding/restoration and after five minutes. The signed previous-success cookie lasts 30 days and records only a successful visit to this site. Instagram/email remain public at all times. Version 2 cookies replace the earlier token format so old sessions/challenges cannot skip the new flow.

Rate limits and spent-nonce detection use a bounded in-process map in both development and production. **They are per instance, not distributed guarantees.** Cold starts reset the cache, replicas have independent budgets, and a valid challenge/solution may be replayed on another replica during its two-minute lifetime. The signed challenge still verifies there without shared state. Global single-use enforcement would require shared storage, which this version deliberately does not use.

All profile/API responses are private/no-store, with CDN-specific no-store headers. Do not add a shared cache in front of `/` or `/api/*`. `robots.txt` and `noindex` are advisory. Moving the destination off initial HTML prevents straightforward collection; it does not make it undiscoverable or remove previously published copies elsewhere.

## ntfy notifications

The existing local environment publishes to `https://ntfy.sh/shilpa-baja-linktree`. Subscribe to `shilpa-baja-linktree` in ntfy to receive alerts. Notification configuration stays server-only:

```dotenv
NTFY_ENABLED=true
NTFY_TOPIC=shilpa-baja-linktree
NTFY_TOKEN=
NTFY_INCLUDE_USER_AGENT_UNTIL=2026-11-15T12:02:05Z
NTFY_DAILY_LIMIT=240
```

Page-request notifications include timestamp and a User-Agent classification hint, including recognized crawler requests. Temporary UA reporting includes up to 512 sanitized characters until the UTC expiry above, then stops automatically. It does not erase already delivered messages. Spoofed or ordinary-looking User-Agents do not establish whether a request came from Instagram.

Next.js `after()` sends visit notifications without delaying the page response. RSC/prefetch requests are excluded. Visits count requests and refreshes, not unique people. Link taps send a same-origin keepalive request without delaying navigation. The categories are Instagram, Email and Subscriber link; subscriber reporting also requires a valid access cookie. No subscriber URL, subscriber copy, email address, raw visitor IP, query string, cookies or credentials are included in the notification payload.

Notifications are best effort. Context-menu navigation, copied URLs, disabled scripts, network errors, false/forged reports and provider limits can produce missed or misleading events. Limits are 12/minute per event and hashed visitor grouping, 30/minute per instance and `NTFY_DAILY_LIMIT` (default 240) per 24 hours per instance. Similar UAs share a grouping when no trusted IP is available. Cold starts/replicas reset or split budgets, so actual ntfy account-wide quotas may still be reached. Failed notification delivery is skipped; there is no durable queue or retry and it does not block access.

Unreserved ntfy topics may be publicly readable and writable. Reserve/access-protect the topic if diagnostics should be private, and set `NTFY_TOKEN` if publishing requires authentication. ntfy normally caches messages for about 12 hours, and subscribers may retain them longer. Temporary UA reporting remains the explicitly requested diagnostic exception to the minimal notification payload.

## Checks

```sh
npm run check:config
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Browser tests use isolated Chrome, fictional contacts, notifications disabled, port 3104 and `.next-test` output. They run the same actual work solver as production, with simulated browser observations, and coexist with the normal development server. Unit tests mock notification delivery. Coverage includes token tampering/expiry, same-origin enforcement, forged headers, invalid/missing work, replay on the same process, stateless Vercel flows, public/private separation, portrait loading, mobile layout, link events and UA expiry. Tests do not certify real-world human identification.

The UI uses a centered Linktree-style layout with dark plum, neon violet and stacked buttons. Design dials: variance 3 / motion 3 / density 3. The unused forest asset remains from the original theme ([source](https://unsplash.com/photos/hg5Tx6c_5nc)).

References: [Web Crypto digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest), [Vercel request headers](https://vercel.com/docs/headers/request-headers), [ntfy publishing and limits](https://docs.ntfy.sh/publish/), [robots.txt limitations](https://developers.google.com/search/docs/crawling-indexing/robots/intro).
