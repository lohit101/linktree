import { existsSync } from "node:fs";
import { getAccessConfig } from "../src/lib/server/config";
import { isVercelRuntime } from "../src/lib/server/platform";

if (existsSync(".env.local")) {
  if (!process.loadEnvFile) throw new Error("Use Node 20.12+ to parse .env.local safely.");
  process.loadEnvFile(".env.local");
}
if (process.argv.includes("--production")) Object.assign(process.env, { NODE_ENV: "production" });
try {
  // On Vercel only, the runtime will check the actual request origin. This placeholder
  // exercises the remaining settings without assuming a CLI knows the routed hostname.
  getAccessConfig(isVercelRuntime() ? new Request("https://runtime-check.invalid") : undefined);
  console.log("Code-only access configuration is ready. No challenge-provider keys or database are needed.");
  if (isVercelRuntime()) console.log("The actual HTTPS origin is derived from each Vercel request.");
} catch {
  console.error("Check SESSION_SECRET (32+ random characters), APP_ORIGIN (exact HTTPS origin outside Vercel), and HUMANITY_THRESHOLD (70–100). No secret values were printed.");
  process.exitCode = 1;
}
