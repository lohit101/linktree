// Public protocol, not a secret. This is a small computational hurdle, not a CAPTCHA
// or proof that the visitor is human. The server independently checks the result.
export const WORK_DIFFICULTY = 3;
export const MAX_WORK_COUNTER = 1048575;

export async function solveBrowserWork(nonce: string, signal: AbortSignal): Promise<number> {
  if (!/^[a-f0-9]{48}$/.test(nonce) || !globalThis.crypto?.subtle) {
    throw new Error("Please open this page in an up-to-date browser over HTTPS.");
  }
  const encoder = new TextEncoder();
  const started = performance.now();
  // Small asynchronous batches keep the page responsive. Expected work: 4096 hashes.
  for (let offset = 0; offset <= MAX_WORK_COUNTER; offset += 64) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (performance.now() - started > 12000) throw new Error("The connection check timed out. Please try again.");
    const batch = await Promise.all(Array.from({ length: Math.min(64, MAX_WORK_COUNTER - offset + 1) }, async (_, index) => {
      const counter = offset + index;
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${nonce}:${counter}`)));
      return hash[0] === 0 && hash[1] < 16 ? counter : -1;
    }));
    const answer = batch.find(value => value >= 0);
    if (answer !== undefined) return answer;
    // Yield between batches rather than continuously occupying the UI thread.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error("Couldn’t finish the connection check. Please try again.");
}
