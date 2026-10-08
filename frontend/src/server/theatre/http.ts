import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getMember } from "@/server/auth/member";
import { checkoutOrigin } from "@/server/checkout/stripe";
import { db } from "@/server/db/client";
import { checkoutLimits } from "@/server/db/schema";

export function theatreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}

export async function theatreRequest(request: Request, scope: string, maximum = 30) {
  if (process.env.THEATRE_ENABLED !== "true") return { response: theatreJson({ error: "Theatre setup is in progress." }, 503) };
  if (request.method !== "GET" && request.headers.get("origin") !== checkoutOrigin()) {
    return { response: theatreJson({ error: "Please use the website directly." }, 403) };
  }
  const member = await getMember();
  if (!member) return { response: theatreJson({ error: "Please sign in." }, 401) };
  if (!member.emailVerified) return { response: theatreJson({ error: "Verify your primary email first." }, 403) };
  const bucket = Math.floor(Date.now() / 60000);
  const key = createHash("sha256").update(`theatre:${scope}:${member.id}:${bucket}`).digest("hex");
  const [limit] = await db().insert(checkoutLimits).values({ key, expiresAt: new Date((bucket + 1) * 60000) })
    .onConflictDoUpdate({ target: checkoutLimits.key, set: { count: sql`${checkoutLimits.count} + 1` } }).returning();
  if (limit.count > maximum) return { response: theatreJson({ error: "Please wait a minute before retrying." }, 429) };
  return { member };
}
