import "server-only";
import { ProtectionError } from "./config";

type Entry = { value: number; expires: number };
const processState = globalThis as typeof globalThis & { cloakState?: Map<string, Entry> };
const memory = processState.cloakState ??= new Map<string, Entry>();

function ensureCapacity() {
  if (memory.size < 10000) return;
  const now = Date.now();
  for (const [key, entry] of memory) if (entry.expires <= now) memory.delete(key);
  if (memory.size >= 10000) throw new ProtectionError(503);
}

// Best-effort PER-PROCESS limits, including in serverless. There is no external store.
// A cold start or another replica has a separate budget; this is not a global limiter.
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const name = `rate:${key}`;
  ensureCapacity();
  const now = Date.now();
  const existing = memory.get(name);
  const entry = existing && existing.expires > now ? existing : { value: 0, expires: now + windowSeconds * 1000 };
  entry.value += 1;
  memory.set(name, entry);
  if (entry.value > limit) throw new ProtectionError(429);
}

// Signed cookies carry all challenge state so requests can reach different replicas.
// This cache rejects replays on the same instance only. Cross-replica replay within
// the signed challenge's two-minute lifetime cannot be eliminated without shared state.
export function consumeChallenge(nonce: string, expires: number) {
  const now = Date.now();
  if (!Number.isFinite(expires) || expires <= now) return false;
  const key = `spent:${nonce}`;
  const existing = memory.get(key);
  if (existing && existing.expires > now) return false;
  ensureCapacity();
  memory.set(key, { value: 1, expires });
  return true;
}
