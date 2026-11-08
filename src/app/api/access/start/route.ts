import { NextRequest } from "next/server";
import { accessContext, accessFailure, limitAccess, privateJson, setAccessCookie } from "@/lib/server/access";
import { randomId } from "@/lib/server/crypto";
import { reserveChallenge } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = accessContext(request);
    await limitAccess(request, context, "start");
    const nonce = randomId();
    await reserveChallenge(nonce);
    const response = privateJson({
      nonce, siteKey: context.localDemo ? null : context.config.siteKey,
      localDemo: context.localDemo,
    });
    setAccessCookie(response, context, "challenge", nonce);
    return response;
  } catch (error) { return accessFailure(error); }
}
