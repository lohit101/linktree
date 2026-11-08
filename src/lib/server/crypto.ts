import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AccessConfig } from "./config";

export const lifetimes = { challenge: 300, session: 600, visit: 60 * 60 * 24 * 30 } as const;
type TokenKind = keyof typeof lifetimes;

const tokenSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["challenge", "session", "visit"]),
  id: z.string().regex(/^[a-f0-9]{48}$/),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  iat: z.number().int(),
  exp: z.number().int(),
}).strict();

export const randomId = () => randomBytes(24).toString("hex");

export function digest(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret).update(`${purpose}\0${value}`).digest("hex");
}

export function constantEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function makeBinding(secret: string, userAgent: string, ip: string | null) {
  return digest(secret, "binding", `${userAgent}\0${ip ?? "unknown"}`);
}

export function signToken(config: Pick<AccessConfig, "secret">, kind: TokenKind, binding: string, id = randomId(), now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const data = Buffer.from(JSON.stringify({ v: 1, kind, id, binding, iat, exp: iat + lifetimes[kind] })).toString("base64url");
  return `${data}.${digest(config.secret, "token", data)}`;
}

export function readToken(config: Pick<AccessConfig, "secret">, value: string | undefined, kind: TokenKind, binding: string, now = Date.now()) {
  if (!value || value.length > 1400) return null;
  const [data, signature, extra] = value.split(".");
  if (!data || !signature || extra || !constantEqual(digest(config.secret, "token", data), signature)) return null;
  try {
    const parsed = tokenSchema.safeParse(JSON.parse(Buffer.from(data, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const token = parsed.data;
    const seconds = Math.floor(now / 1000);
    if (token.kind !== kind || token.exp <= seconds || token.iat > seconds + 10 ||
      token.exp - token.iat !== lifetimes[kind] || !constantEqual(token.binding, binding)) return null;
    return token;
  } catch { return null; }
}

export function cookieName(production: boolean, kind: TokenKind) {
  return `${production ? "__Host-" : ""}cloak-${kind}`;
}
