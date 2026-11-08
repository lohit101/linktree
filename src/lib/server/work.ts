import "server-only";
import { createHash } from "node:crypto";
import { MAX_WORK_COUNTER, WORK_DIFFICULTY } from "@/lib/work";

export function validateWork(nonce: string, counter: number) {
  if (!/^[a-f0-9]{48}$/.test(nonce) || !Number.isInteger(counter) || counter < 0 || counter > MAX_WORK_COUNTER) return false;
  return createHash("sha256").update(`${nonce}:${counter}`).digest("hex").startsWith("0".repeat(WORK_DIFFICULTY));
}
