# Enable verification on Vercel

The Instagram profile picture is bundled locally in `public/profile.jpg`. Instagram/email remain public. The subscriber destination stays locked whenever required verification configuration is missing; a normal browser does not bypass missing setup.

## Required production environment

Set these in the Vercel project's production environment, then redeploy:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://shilpa-bajaj.vercel.app` (no trailing slash) |
| `SESSION_SECRET` | A stable random secret of at least 32 characters; generate with `openssl rand -hex 48`. |
| `TURNSTILE_SITE_KEY` | Site key from a real Managed Turnstile widget. |
| `TURNSTILE_SECRET_KEY` | The matching secret key; keep it in the host's secret store. |
| `UPSTASH_REDIS_REST_URL` | Shared Redis REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Matching Redis REST token. |
| `CONTACT_FANVUE_URL` | Your protected subscriber destination. This is never included in Git. |
| `PRIVATE_BIO` | Optional verified-only subscriber sentence. |
| `CONTACT_INSTAGRAM_URL`, `CONTACT_EMAIL` | The public profile links. |

Also copy the `NTFY_*` runtime settings if you want notifications on the hosted site. `.env.local` is excluded from Git and does not become Vercel runtime configuration automatically.

In Cloudflare Turnstile, allow **shilpa-bajaj.vercel.app** as a hostname on the widget. Use real production keys, not Cloudflare's always-pass test keys. If you add a custom domain, allow that hostname too and update `APP_ORIGIN` to the exact domain visitors will use. Keep the page and API on the same canonical origin.

Vercel serverless deployments require shared Redis. Do not enable `SINGLE_PROCESS_MEMORY` on Vercel. `ALLOW_LOCAL_DEMO` never works in production and must not be used to expose real private links.

## Native Vercel networking

The app now recognizes Vercel's server-provided runtime environment and uses its overwritten `x-vercel-forwarded-for` client-IP header, with optional Vercel country/timezone headers. It ignores client-supplied custom bot scores. You do not need a separate Cloudflare Worker, Nginx proxy or `PROXY_SHARED_SECRET` when running directly on Vercel. Do not set `VERCEL` manually on other hosts.

Outside Vercel, the authenticated proxy integration remains required. If another proxy sits in front of Vercel, its IP may be seen as the client IP; use the platform's trusted-proxy integration if needed.

Source: [Vercel request headers and IP-overwrite behavior](https://vercel.com/docs/headers/request-headers).

## Diagnose without exposing secrets

```sh
npm run check:config
npm run check:config -- --production
```

The first command checks the current local environment; the second adds production requirements. To check the host's configuration, run with the host's environment available, rather than assuming `.env.local` matches it. The command prints missing variable names, never their values. It does not contact providers or prove that supplied keys are valid.

With configuration present, a successful browser flow is: `/api/contacts` returns 401 initially, `/api/access/start` succeeds, the real Turnstile token is validated by `/api/access/verify`, then `/api/contacts` returns the private link. A 503 before the challenge normally means missing/invalid configuration or unavailable infrastructure, rather than a low humanity score.
