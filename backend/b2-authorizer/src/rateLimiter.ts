interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 120; // 120 requests per minute per UID

export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

export function checkRateLimit(uid: string, env?: { RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> } }): void | Promise<void> {
  if (env?.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    return (async () => {
      const { success } = await env.RATE_LIMITER!.limit({ key: uid });
      if (!success) {
        throw new RateLimitExceededError(
          `Rate limit exceeded for user ${uid}.`
        );
      }
    })();
  }

  const now = Date.now();
  const entry = rateLimitMap.get(uid);

  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(uid, {
      count: 1,
      resetAt: now + WINDOW_MS
    });
    return;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new RateLimitExceededError(
      `Rate limit exceeded for user ${uid}. Max ${MAX_REQUESTS_PER_WINDOW} requests per minute.`
    );
  }

  entry.count++;

  // Cleanup expired entries when map grows large
  if (rateLimitMap.size > 1000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (value.resetAt <= now) {
        rateLimitMap.delete(key);
      }
    }
  }
}

export function resetRateLimitsForTesting(): void {
  rateLimitMap.clear();
}
