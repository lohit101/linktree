import { NextRequest } from "next/server";
import { accessContext, accessFailure, limitAccess, privateJson, setAccessCookie } from "@/lib/server/access";
import { randomId } from "@/lib/server/crypto";
import { WORK_DIFFICULTY } from "@/lib/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = accessContext(request);
    await limitAccess(request, context, "start");
    const nonce = randomId();
    const response = privateJson({ nonce, difficulty: WORK_DIFFICULTY });
    setAccessCookie(response, context, "challenge", nonce);
    return response;
  } catch (error) { return accessFailure(error); }
}
