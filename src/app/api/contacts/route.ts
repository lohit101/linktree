import { NextRequest } from "next/server";
import { accessContext, accessFailure, limitAccess, privateJson, readAccessCookie } from "@/lib/server/access";
import { getPrivateBio, getPrivateContacts, ProtectionError } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = accessContext(request, false);
    await limitAccess(request, context, "contacts");
    if (!readAccessCookie(request, context, "session")) throw new ProtectionError(401);
    return privateJson({ contacts: getPrivateContacts(), bio: getPrivateBio() });
  } catch (error) { return accessFailure(error); }
}
