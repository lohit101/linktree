import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getAccessConfig, isLocalDemoRequest, ProtectionError } from "./config";
import { cookieName, digest, lifetimes, makeBinding, readToken, signToken } from "./crypto";
import { checkOrigin, checkRequest, getNetwork } from "./request";
import { rateLimit } from "./state";

export function accessContext(request: NextRequest, requireOrigin = true) {
  const config = getAccessConfig();
  checkOrigin(request, config, requireOrigin);
  const network = getNetwork(request.headers, config);
  checkRequest(request, network, config.production);
  const userAgent = request.headers.get("user-agent") ?? "";
  const binding = makeBinding(config.secret, userAgent, network.ip);
  return { config, network, binding, localDemo: isLocalDemoRequest(config, request) };
}

export async function limitAccess(request: NextRequest, context: ReturnType<typeof accessContext>, phase: "start" | "verify" | "contacts") {
  const { config, network, binding } = context;
  const limit = phase === "contacts" ? 80 : 12;
  await rateLimit(`${phase}:${binding}`, limit, 600);
  // An independent IP limit prevents changing User-Agent from resetting the budget.
  if (network.ip) await rateLimit(`${phase}:ip:${digest(config.secret, "rate-ip", network.ip)}`, phase === "contacts" ? 250 : 40, 600);
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 12288) throw new ProtectionError(413);
}

export function readAccessCookie(request: NextRequest, context: ReturnType<typeof accessContext>, kind: keyof typeof lifetimes) {
  return readToken(context.config, request.cookies.get(cookieName(context.config.production, kind))?.value, kind, context.binding);
}

export function setAccessCookie(response: NextResponse, context: ReturnType<typeof accessContext>, kind: keyof typeof lifetimes, id?: string) {
  response.cookies.set(cookieName(context.config.production, kind), signToken(context.config, kind, context.binding, id), {
    httpOnly: true,
    secure: context.config.production,
    sameSite: "strict",
    path: "/",
    maxAge: lifetimes[kind],
  });
}

export function clearAccessCookie(response: NextResponse, production: boolean, kind: keyof typeof lifetimes) {
  response.cookies.set(cookieName(production, kind), "", {
    httpOnly: true, secure: production, sameSite: "strict", path: "/", maxAge: 0,
  });
}

export function privateJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "Vary": "Cookie, Origin, User-Agent",
  } });
}

export function accessFailure(error: unknown) {
  const status = error instanceof ProtectionError ? error.status : 503;
  const message = status === 429 ? "Please wait a few minutes before trying again." :
    status === 503 ? "Links are unavailable for now. Please try again later." :
      "We couldn’t open these links. Please try again in your browser.";
  const response = privateJson({ error: message }, status);
  if (status === 429) response.headers.set("Retry-After", "600");
  return response;
}
