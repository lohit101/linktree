import { NextRequest } from "next/server";
import { z } from "zod";
import { accessContext, accessFailure, privateJson, readAccessCookie } from "@/lib/server/access";
import { ProtectionError } from "@/lib/server/config";
import { notifyLink } from "@/lib/server/notifications";
import { readSmallJson } from "@/lib/server/request";

const schema = z.object({ link: z.enum(["instagram", "email", "subscription"]) }).strict();
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Public link reporting works even when private verification has not been configured.
    const expected = process.env.APP_ORIGIN;
    if (!expected || request.headers.get("origin") !== expected ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) throw new ProtectionError();
    const parsed = schema.safeParse(await readSmallJson(request));
    if (!parsed.success) throw new ProtectionError(400);
    if (parsed.data.link === "subscription") {
      const context = accessContext(request);
      if (!readAccessCookie(request, context, "session")) throw new ProtectionError(401);
    }
    await notifyLink(request.headers, parsed.data.link);
    return privateJson({ ok: true });
  } catch (error) { return accessFailure(error); }
}
