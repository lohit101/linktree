import "server-only";
import { digest } from "./crypto";
import { getNetwork, isKnownCrawler } from "./request";
import { rateLimit } from "./state";

export type LinkEvent = "instagram" | "email" | "subscription";

export function visitMessage(headers: Headers, now = new Date()) {
  const ua = (headers.get("user-agent") ?? "unknown").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 512);
  const until = Date.parse(process.env.NTFY_INCLUDE_USER_AGENT_UNTIL ?? "");
  const lines = ["The profile received a page visit.", `Time: ${now.toISOString()}`,
    `UA hint: ${isKnownCrawler(ua) ? "recognized crawler/automation" : "browser-like or unrecognized"} (not proof of source).`];
  if (Number.isFinite(until) && now.getTime() < until) lines.push(`User-Agent: ${ua}`);
  return lines.join("\n");
}

export function isDocumentVisit(headers: Headers) {
  return !headers.has("rsc") && !headers.has("next-router-prefetch") &&
    !headers.get("purpose")?.includes("prefetch") && !headers.get("sec-purpose")?.includes("prefetch");
}

export async function publishNotification(title: string, message: string): Promise<boolean> {
  if (process.env.NTFY_ENABLED !== "true") return false;
  const topic = process.env.NTFY_TOPIC ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return false;
  try {
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", Title: title, Priority: "3" };
    if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST", headers, body: message, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) console.warn(`[ntfy] Delivery failed (HTTP ${response.status}).`);
    return response.ok;
  } catch { console.warn("[ntfy] Delivery unavailable."); return false; }
}

async function notificationBudget(headers: Headers, event: string) {
  if (process.env.NTFY_ENABLED !== "true" || !process.env.SESSION_SECRET) return false;
  const network = getNetwork(headers, { proxySecret: process.env.PROXY_SHARED_SECRET ?? "" });
  const key = digest(process.env.SESSION_SECRET, "notification", `${network.ip ?? "unknown"}\0${headers.get("user-agent") ?? "unknown"}`);
  try {
    await rateLimit(`ntfy:${event}:${key}`, 12, 60);
    await rateLimit("ntfy:minute", 30, 60);
    const daily = Number(process.env.NTFY_DAILY_LIMIT ?? "240");
    if (!Number.isInteger(daily) || daily < 1 || daily > 100000) return false;
    await rateLimit("ntfy:day", daily, 86400);
    return true;
  } catch { return false; }
}

export async function notifyVisit(headers: Headers) {
  if (!isDocumentVisit(headers) || !await notificationBudget(headers, "visit")) return false;
  return publishNotification("Profile visit", visitMessage(headers));
}

export async function notifyLink(headers: Headers, link: LinkEvent) {
  if (!await notificationBudget(headers, `tap:${link}`)) return false;
  const label = { instagram: "Instagram", email: "Email", subscription: "Subscriber link" }[link];
  // Never forward destination URLs, email addresses, visitor IPs, or private subscriber copy.
  return publishNotification("Profile link tapped", `${label} was tapped.\nTime: ${new Date().toISOString()}\nThis is a reported link activation, not proof of a unique human.`);
}
