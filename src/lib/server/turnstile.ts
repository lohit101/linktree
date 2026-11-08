import "server-only";
import type { AccessConfig } from "./config";
import { ProtectionError } from "./config";

export const challengeAction = "contact_access";

export async function validateChallenge(config: AccessConfig, token: string, nonce: string, ip: string | null) {
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: config.challengeSecret, response: token });
  if (ip) body.set("remoteip", ip);
  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(7000),
    });
  } catch { throw new ProtectionError(503); }
  if (!response.ok) throw new ProtectionError(503);
  let result: Record<string, unknown>;
  try { result = await response.json(); } catch { throw new ProtectionError(503); }
  return result.success === true && result.hostname === config.origin.hostname &&
    result.action === challengeAction && result.cdata === nonce;
}
