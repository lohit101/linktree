import "server-only";

// Hosting trust comes from server environment, never a request header or client flag.
export function isVercelRuntime() {
  return process.env.NODE_ENV === "production" && process.env.VERCEL === "1";
}
