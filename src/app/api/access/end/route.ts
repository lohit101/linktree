import { NextRequest } from "next/server";
import { accessContext, accessFailure, clearAccessCookie, privateJson } from "@/lib/server/access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = accessContext(request);
    const response = privateJson({ ok: true });
    clearAccessCookie(response, context.config.production, "session");
    clearAccessCookie(response, context.config.production, "challenge");
    return response;
  } catch (error) { return accessFailure(error); }
}
