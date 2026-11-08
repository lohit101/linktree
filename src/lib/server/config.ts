import "server-only";
import { z } from "zod";
import type { Contact } from "@/lib/contracts";
import { isVercelRuntime } from "./platform";

export class ProtectionError extends Error {
  constructor(public readonly status: number = 403) {
    super("Access unavailable");
  }
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
// On Vercel the actual routed HTTPS origin wins over a copied localhost setting.
// No client-supplied Origin or forwarded-host header is used to choose the server origin.
export function getRequestOrigin(request?: Request): URL {
  let value = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
  if (request && isVercelRuntime()) value = new URL(request.url).origin;
  let origin: URL;
  try { origin = new URL(value); } catch { throw new ProtectionError(503); }
  if (origin.origin !== value || !["https:", "http:"].includes(origin.protocol)) throw new ProtectionError(503);
  if (process.env.NODE_ENV === "production" && (origin.protocol !== "https:" || localHosts.has(origin.hostname))) throw new ProtectionError(503);
  return origin;
}

export function getAccessConfig(request?: Request) {
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32 || /GENERATE_|REPLACE_/i.test(secret)) throw new ProtectionError(503);
  const origin = getRequestOrigin(request);
  const threshold = Number(process.env.HUMANITY_THRESHOLD ?? "75");
  if (!Number.isInteger(threshold) || threshold < 70 || threshold > 100) throw new ProtectionError(503);
  const proxySecret = process.env.PROXY_SHARED_SECRET ?? "";
  return { production, origin, secret, proxySecret, threshold };
}

export type AccessConfig = ReturnType<typeof getAccessConfig>;

// Public links are intentionally serialized into the page for every visitor, including crawlers.
export function getPublicContacts(): Contact[] {
  const contacts: Contact[] = [];
  const email = process.env.CONTACT_EMAIL?.trim();
  const instagram = process.env.CONTACT_INSTAGRAM_URL?.trim();
  if (instagram) {
    const url = checkedUrl(instagram, ["instagram.com", "www.instagram.com"]);
    contacts.push({ id: "instagram", kind: "instagram", label: "Instagram", detail: `@${url.pathname.split("/").filter(Boolean)[0] ?? ""}`, href: url.href });
  }
  if (email) {
    if (!z.email().safeParse(email).success || /[\r\n]/.test(email)) throw new ProtectionError(503);
    contacts.push({ id: "email", kind: "email", label: "Email me", detail: email, href: `mailto:${email}` });
  }
  return contacts;
}

// Called only AFTER authorization. No legacy phone, Twitter, Pinterest or extra links.
export function getPrivateContacts(): Contact[] {
  const value = process.env.CONTACT_FANVUE_URL?.trim();
  if (!value) return [];
  const url = checkedUrl(value, ["fanvue.com", "www.fanvue.com"]);
  return [{ id: "subscription", kind: "subscription", label: "Exclusive content ✨", detail: "Come see my private side", iconEmoji: "😈", href: url.href }];
}

function checkedUrl(value: string, domains: string[]) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProtectionError(503); }
  if (url.protocol !== "https:" || url.username || url.password || !domains.includes(url.hostname)) throw new ProtectionError(503);
  return url;
}

export function getPrivateBio(): string | null {
  const value = process.env.PRIVATE_BIO?.trim();
  if (!value) return null;
  if (value.length > 280) throw new ProtectionError(503);
  return value;
}
