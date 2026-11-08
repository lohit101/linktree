import { existsSync } from "node:fs";
import { getAccessConfig } from "../src/lib/server/config";

// Use Node's dotenv parser where available; it never overwrites existing host variables.
if (existsSync(".env.local")) {
  if (process.loadEnvFile) process.loadEnvFile(".env.local");
  else {
    console.error("This diagnostic requires Node 20.12+ to parse .env.local safely.");
    process.exit(1);
  }
}
if (process.argv.includes("--production")) Object.assign(process.env, { NODE_ENV: "production" });
const production = process.env.NODE_ENV === "production";
const issues: string[] = [];
const need = (name: string) => { if (!process.env[name]?.trim()) issues.push(`${name} is missing.`); };
need("APP_ORIGIN");
if ((process.env.SESSION_SECRET?.length ?? 0) < 32) issues.push("SESSION_SECRET needs at least 32 random characters.");
const localDemo = !production && process.env.ALLOW_LOCAL_DEMO === "true";
if (!localDemo) { need("TURNSTILE_SITE_KEY"); need("TURNSTILE_SECRET_KEY"); }
if (production) {
  if (!process.env.APP_ORIGIN?.startsWith("https://")) issues.push("APP_ORIGIN must be the exact live HTTPS origin without a trailing slash.");
  if (process.env.VERCEL !== "1" && (process.env.PROXY_SHARED_SECRET?.length ?? 0) < 32) issues.push("Configure a trusted proxy and PROXY_SHARED_SECRET, or run on Vercel's native edge.");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (process.env.VERCEL === "1" || process.env.SINGLE_PROCESS_MEMORY !== "true") issues.push("Shared Redis URL/token are required for Vercel/serverless or multiple processes.");
  }
}
try { getAccessConfig(); } catch {
  if (!issues.length) issues.push("Access configuration is invalid. Check origin format, real challenge keys, threshold and independent random secrets.");
}
if (issues.length) {
  console.error("Subscriber links remain locked because:");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("Set the missing runtime values on the host, allow the live hostname in Turnstile, then redeploy. Secrets are not stored in Git.");
  process.exitCode = 1;
} else {
  console.log(localDemo ? "Local demo mode is enabled; this does not verify humanity." : "Required configuration is present. Live provider, network and browser verification must still succeed.");
}
