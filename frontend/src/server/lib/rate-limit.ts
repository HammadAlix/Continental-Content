import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export interface RateLimitResult { allowed: boolean; retryAfter?: number }
export const LIMITS = { perIpPerHour: 3, perIpPerDay: 10 } as const;

export async function hashIp(value: string): Promise<string> {
  const salt = process.env.IP_HASH_SALT;
  if (!salt || salt.length < 32) throw new Error("A private IP_HASH_SALT is required.");
  return createHmac("sha256", salt).update(value).digest("hex");
}

export async function consumeLimit(key: string, seconds: number, limit: number): Promise<RateLimitResult> {
  const now = Date.now();
  const window = Math.floor(now / (seconds * 1000));
  const expires = new Date((window + 1) * seconds * 1000);
  const opaqueKey = await hashIp(`office:${key}:${seconds}:${window}`);
  // Atomic conditional update; concurrent requests cannot pass an exhausted limit.
  const result = await db().execute(sql`
    INSERT INTO checkout_limits (key, count, expires_at) VALUES (${opaqueKey}, 1, ${expires.toISOString()}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET count = checkout_limits.count + 1
    WHERE checkout_limits.count < ${limit} RETURNING count
  `);
  return result.rows.length ? { allowed: true } : { allowed: false, retryAfter: Math.max(1, Math.ceil((expires.getTime() - now) / 1000)) };
}

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const hourly = await consumeLimit(key, 3600, LIMITS.perIpPerHour);
  if (!hourly.allowed) return hourly;
  return consumeLimit(key, 86400, LIMITS.perIpPerDay);
}
