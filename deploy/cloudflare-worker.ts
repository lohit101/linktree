// Optional trusted edge adapter. Deploy on the public hostname, in front of the Next.js origin.
// Do NOT put any contact values here. Keep PROXY_SHARED_SECRET in Worker secrets.
interface Env { ORIGIN_URL: string; PROXY_SHARED_SECRET: string }
type EdgeRequest = Request & { cf?: {
  country?: string;
  timezone?: string;
  botManagement?: { score: number; verifiedBot: boolean };
} };

export default {
  async fetch(request: EdgeRequest, env: Env): Promise<Response> {
    const origin = new URL(env.ORIGIN_URL);
    if (origin.protocol !== "https:" || env.PROXY_SHARED_SECRET.length < 32) return new Response("Unavailable", { status: 503 });
    const source = new URL(request.url);
    const target = new URL(`${source.pathname}${source.search}`, origin);
    // Never let an absolute or protocol-relative request path change the upstream host.
    if (target.origin !== origin.origin) return new Response("Unavailable", { status: 400 });
    const headers = new Headers(request.headers);
    for (const key of Array.from(headers.keys())) if (key.toLowerCase().startsWith("x-cloak-")) headers.delete(key);
    headers.set("x-cloak-proxy-secret", env.PROXY_SHARED_SECRET);
    headers.set("x-cloak-client-ip", request.headers.get("cf-connecting-ip") ?? "");
    headers.set("x-cloak-country", request.cf?.country ?? "");
    headers.set("x-cloak-timezone", request.cf?.timezone ?? "");
    // Cloudflare's numeric Bot Management score requires an eligible paid plan.
    // Unknown scores remain absent; a verified bot is never granted private access.
    if (request.cf?.botManagement) {
      headers.set("x-cloak-bot-score", String(request.cf.botManagement.score));
      headers.set("x-cloak-verified-bot", String(request.cf.botManagement.verifiedBot));
    }
    headers.delete("host");
    return fetch(new Request(target, {
      method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    }), { cache: "no-store" });
  },
};
