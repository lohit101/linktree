import "server-only";
import { z } from "zod";
import type { Contact } from "@/lib/contracts";

export class ProtectionError extends Error {
  constructor(public readonly status: number = 403) {
    super("Access unavailable");
  }
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const testKey = /^[123]x0{10,}/;

export function getAccessConfig() {
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET ?? "";
  const originValue = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
  let origin: URL;
  try { origin = new URL(originValue); } catch { throw new ProtectionError(503); }
  if (origin.origin !== originValue || secret.length < 32) throw new ProtectionError(503);

  const siteKey = process.env.TURNSTILE_SITE_KEY ?? "";
  const challengeSecret = process.env.TURNSTILE_SECRET_KEY ?? "";
  const proxySecret = process.env.PROXY_SHARED_SECRET ?? "";
  const localDemo = !production && process.env.ALLOW_LOCAL_DEMO === "true" && localHosts.has(origin.hostname);
  const threshold = Number(process.env.HUMANITY_THRESHOLD ?? "75");
  if (!Number.isInteger(threshold) || threshold < 70 || threshold > 100) throw new ProtectionError(503);

  if (!localDemo && (!siteKey || !challengeSecret)) throw new ProtectionError(503);
  if (production && (
    origin.protocol !== "https:" || localHosts.has(origin.hostname) ||
    proxySecret.length < 32 || proxySecret === secret || /GENERATE_|REPLACE_/i.test(`${secret} ${proxySecret}`) ||
    testKey.test(siteKey) || testKey.test(challengeSecret) ||
    (!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) &&
      process.env.SINGLE_PROCESS_MEMORY !== "true")
  )) throw new ProtectionError(503);

  return { production, origin, secret, siteKey, challengeSecret, proxySecret, localDemo, threshold };
}

export type AccessConfig = ReturnType<typeof getAccessConfig>;

export function isLocalDemoRequest(config: AccessConfig, request: Request) {
  return config.localDemo && localHosts.has(new URL(request.url).hostname);
}

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
  return [{ id: "subscription", kind: "subscription", label: "My Fanvue", detail: "A little more of my world", href: url.href }];
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
