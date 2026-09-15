import "server-only";
import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { checkoutLimits } from "@/server/db/schema";

export async function allowCheckoutRequest(request: Request, scope: "create" | "status") {
  const hour = Math.floor(Date.now() / 3600000);
  // Vercel supplies this trusted header; other hosts must sanitize forwarded headers.
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Missing checkout configuration.");
  const key = createHmac("sha256", secret).update(`${scope}:${hour}:${ip}`).digest("hex");
  const [limit] = await db().insert(checkoutLimits).values({ key, expiresAt: new Date((hour + 1) * 3600000) })
    .onConflictDoUpdate({ target: checkoutLimits.key, set: { count: sql`${checkoutLimits.count} + 1` } }).returning();
  await db().delete(checkoutLimits).where(lt(checkoutLimits.expiresAt, new Date()));
  return limit.count <= (scope === "create" ? 20 : 120);
}
