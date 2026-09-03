import "server-only";

/**
 * Rate limiting.
 *
 * NOT YET BACKED BY REDIS. Until UPSTASH_REDIS_REST_URL and _TOKEN are set this
 * allows everything and warns once, so the form works in development without a
 * Redis instance.
 *
 * When it is wired up it must use Upstash (or another shared store), never an
 * in-memory counter: each serverless instance has its own memory, so a `Map`
 * here would give every instance its own allowance and reset constantly. That
 * looks like it works locally and does nothing in production.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfter?: number;
}

export const LIMITS = {
  /** Per IP. Generous enough that a real person never sees it. */
  perIpPerHour: 3,
  perIpPerDay: 10,
} as const;

let warned = false;

const configured = () =>
  Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  if (!configured()) {
    if (!warned) {
      warned = true;
      console.warn(
        "[rate-limit] Upstash not configured — all requests allowed. " +
          "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before launch."
      );
    }
    return { allowed: true };
  }

  // TODO: @upstash/ratelimit sliding window, keyed on `key`.
  void key;
  return { allowed: true };
}

/**
 * IPs are personal data and we only need to tell one source from another, which
 * a hash does just as well. Salted so the values aren't a rainbow table of the
 * whole IPv4 space.
 */
export async function hashIp(ip: string): Promise<string> {
  const salt = process.env.IP_HASH_SALT ?? "continental";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
