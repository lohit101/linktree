# Vercel: no new accounts or service credentials

The page now uses its own browser work/scoring checks. No external verification provider or database is used. The Instagram photo, public links and optional ntfy integration are preserved.

Keep these existing runtime values in Vercel:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Stable random signing secret of at least 32 characters. Use the one already copied from local setup. |
| `CONTACT_INSTAGRAM_URL`, `CONTACT_EMAIL` | Public links. |
| `CONTACT_FANVUE_URL` | Server-only subscriber destination. |
| `PRIVATE_BIO` | Optional server-only subscription sentence. |
| `NTFY_*` | Existing optional notifications. |

The actual HTTPS request origin is used automatically on Vercel, including preview deployments and custom domains. A stale localhost `APP_ORIGIN` no longer blocks it. Other hosts should set `APP_ORIGIN` to their exact HTTPS origin. Native Vercel client-IP metadata is used only in Vercel's server runtime; a client header cannot enable platform trust.

Remove the old challenge-provider keys, database variables, local demo toggle and single-process toggle if you want to tidy the hosting environment; they are no longer read. A proxy/Worker is not required. `.env.local` remains excluded from Git, so private contact values and the signing secret must still be in the host's runtime environment.

Push to the connected repository to trigger your normal Vercel deployment. The expected browser flow is: an initial `/api/contacts` 401, successful `/api/access/start`, browser computation and scoring at `/api/access/verify`, then an authorized `/api/contacts` 200. Missing provider credentials cannot cause 503 anymore. Invalid/missing signing configuration can still cause 503; rejected browser checks return 403 and local rate limits return 429.

The checks deter simple automation only. Computation and client observations do not prove humanity. An advanced automated browser can pass, and a human reviewer can view and copy the link. Nonce replay detection and request/notification limits are best effort per instance: cold starts and separate replicas have independent caches. The signed challenge can be checked across replicas without a database; a replay may succeed on another replica until its two-minute expiry.

Use `npm run check:config` for local settings. If checking a self-hosted production environment, add `-- --production`. The diagnostic prints no secrets. On Vercel it checks static signing/threshold settings; the actual origin is validated on each request.
