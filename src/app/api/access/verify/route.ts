import { NextRequest } from "next/server";
import { verificationSchema } from "@/lib/contracts";
import { accessContext, accessFailure, clearAccessCookie, limitAccess, privateJson, readAccessCookie, setAccessCookie } from "@/lib/server/access";
import { ProtectionError } from "@/lib/server/config";
import { readSmallJson } from "@/lib/server/request";
import { scoreVisitor } from "@/lib/server/score";
import { consumeChallenge } from "@/lib/server/state";
import { validateWork } from "@/lib/server/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = accessContext(request);
    await limitAccess(request, context, "verify");
    const parsed = verificationSchema.safeParse(await readSmallJson(request));
    if (!parsed.success) throw new ProtectionError(400);
    const data = parsed.data;
    const proof = readAccessCookie(request, context, "challenge");
    if (!proof || proof.id !== data.nonce) throw new ProtectionError();
    if (data.website || data.signals.webdriver || !data.signals.cookiesEnabled) throw new ProtectionError();
    const elapsed = Date.now() - proof.iat;
    if (elapsed < 900 || !validateWork(data.nonce, data.counter)) throw new ProtectionError();
    const result = scoreVisitor({
      signals: data.signals, headers: request.headers, network: context.network,
      challengePassed: true, returningVisitor: !!readAccessCookie(request, context, "visit"),
      serverElapsedMs: elapsed, honeypot: data.website,
    });
    if (result.denied || result.score < context.config.threshold || !consumeChallenge(data.nonce, proof.exp)) throw new ProtectionError();
    const response = privateJson({ ok: true });
    setAccessCookie(response, context, "session");
    setAccessCookie(response, context, "visit");
    clearAccessCookie(response, context.config.production, "challenge");
    return response;
  } catch (error) { return accessFailure(error); }
}
