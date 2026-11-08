import "server-only";
import { isIP } from "node:net";
import type { AccessConfig } from "./config";
import { ProtectionError } from "./config";
import { constantEqual } from "./crypto";
import { isVercelRuntime } from "./platform";

// Never block the Instagram in-app browser just because it contains "Instagram".
const crawlerPattern = /facebookexternalhit|facebookcatalog|facebot|meta-externalagent|meta-externalfetcher|meta-webindexer|\bmeta-ai\b|googlebot|googleother|bingbot|bingpreview|duckduckbot|yandexbot|baiduspider|applebot|twitterbot|pinterestbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|perplexitybot|perplexity-user|bytespider|amazonbot|ccbot|petalbot|semrush|ahrefs|mj12bot|dotbot|crawler|spider|headlesschrome|phantomjs|python-requests|python-urllib|scrapy|curl\/|wget\/|go-http-client|httpclient|node-fetch|undici/i;

export function isKnownCrawler(userAgent: string) {
  return !userAgent.trim() || crawlerPattern.test(userAgent);
}

export type NetworkContext = {
  ip: string | null;
  country: string | null;
  timezone: string | null;
  botScore: number | null;
  verifiedBot: boolean;
  trusted: boolean;
};

export function getNetwork(headers: Headers, config: Pick<AccessConfig, "proxySecret">): NetworkContext {
  const empty: NetworkContext = { ip: null, country: null, timezone: null, botScore: null, verifiedBot: false, trusted: false };
  const supplied = headers.get("x-cloak-proxy-secret") ?? "";
  if (config.proxySecret.length < 32 || !constantEqual(supplied, config.proxySecret)) {
    // Vercel overwrites these edge headers. Do not use a generic forwarded header or
    // accept spoofed X-Cloak score fields just because the request claims to be Vercel.
    if (!isVercelRuntime()) return empty;
    const ip = headers.get("x-vercel-forwarded-for") ?? "";
    if (!isIP(ip)) return empty;
    const country = headers.get("x-vercel-ip-country") ?? "";
    const timezone = headers.get("x-vercel-ip-timezone") ?? "";
    return {
      ip, country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null,
      timezone: timezone.length <= 100 && timezone.includes("/") ? timezone : null,
      botScore: null, verifiedBot: false, trusted: true,
    };
  }

  const rawIp = headers.get("x-cloak-client-ip") ?? "";
  const country = headers.get("x-cloak-country") ?? "";
  const timezone = headers.get("x-cloak-timezone") ?? "";
  const rawScore = headers.get("x-cloak-bot-score");
  const score = rawScore && /^\d{1,2}$/.test(rawScore) ? Number(rawScore) : null;
  return {
    ip: isIP(rawIp) ? rawIp : null,
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null,
    timezone: timezone.length <= 100 && timezone.includes("/") ? timezone : null,
    botScore: score !== null && score >= 1 && score <= 99 ? score : null,
    verifiedBot: headers.get("x-cloak-verified-bot") === "true",
    trusted: true,
  };
}

export function checkOrigin(request: Request, config: AccessConfig, requireOrigin = true) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((requireOrigin && !origin) || (origin && origin !== config.origin.origin) ||
    (fetchSite && !["same-origin", "none"].includes(fetchSite))) throw new ProtectionError();
}

export function checkRequest(request: Request, network: NetworkContext) {
  if (isKnownCrawler(request.headers.get("user-agent") ?? "") || network.verifiedBot ||
    (network.botScore !== null && network.botScore < 30)) throw new ProtectionError();
  // Missing trusted network metadata receives no network bonus. It is not a setup error.
}

export async function readSmallJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ProtectionError(415);
  if (!request.body) throw new ProtectionError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 12288) { await reader.cancel(); throw new ProtectionError(413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ProtectionError) throw error;
    throw new ProtectionError(400);
  } finally { reader.releaseLock(); }
}
