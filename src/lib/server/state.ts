import "server-only";
import { Redis } from "@upstash/redis";
import { ProtectionError } from "./config";
import { isVercelRuntime } from "./platform";

type Entry = { value: number; expires: number };
const processState = globalThis as typeof globalThis & {
  cloakState?: Map<string, Entry>;
  cloakRedis?: Redis;
};
const memory = processState.cloakState ??= new Map<string, Entry>();

function redis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return processState.cloakRedis ??= new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 0 },
    signal: () => AbortSignal.timeout(4000),
  });
}

function checkMemoryAllowed() {
  if (process.env.NODE_ENV === "production" && (isVercelRuntime() || process.env.SINGLE_PROCESS_MEMORY !== "true")) throw new ProtectionError(503);
  if (memory.size >= 10000) {
    const now = Date.now();
    for (const [key, entry] of memory) if (entry.expires <= now) memory.delete(key);
    if (memory.size >= 10000) throw new ProtectionError(503);
  }
}

const rateScript = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`;

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const name = `cloak:rate:${key}`;
  try {
    const client = redis();
    let count: number;
    if (client) {
      count = Number(await client.eval(rateScript, [name], [windowSeconds]));
    } else {
      checkMemoryAllowed();
      const now = Date.now();
      const existing = memory.get(name);
      const entry = existing && existing.expires > now ? existing : { value: 0, expires: now + windowSeconds * 1000 };
      entry.value += 1;
      memory.set(name, entry);
      count = entry.value;
    }
    if (count > limit) throw new ProtectionError(429);
  } catch (error) {
    if (error instanceof ProtectionError) throw error;
    throw new ProtectionError(503);
  }
}

export async function reserveChallenge(nonce: string, issuedAt = Date.now()) {
  const key = `cloak:nonce:${nonce}`;
  try {
    const client = redis();
    if (client) await client.set(key, issuedAt, { ex: 300 });
    else {
      checkMemoryAllowed();
      memory.set(key, { value: issuedAt, expires: issuedAt + 300000 });
    }
  } catch { throw new ProtectionError(503); }
}

// GETDEL is atomic across replicas. Two parallel verifications cannot spend one nonce twice.
export async function consumeChallenge(nonce: string) {
  const key = `cloak:nonce:${nonce}`;
  try {
    const client = redis();
    if (client) {
      const value = await client.getdel<number>(key);
      return typeof value === "number" ? value : null;
    }
    checkMemoryAllowed();
    const entry = memory.get(key);
    memory.delete(key);
    return entry && entry.expires > Date.now() ? entry.value : null;
  } catch { throw new ProtectionError(503); }
}
