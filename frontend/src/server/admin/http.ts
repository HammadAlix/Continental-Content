import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getAdmin } from "@/server/auth/admin";
import { db } from "@/server/db/client";
import { checkoutLimits } from "@/server/db/schema";
import { checkoutOrigin } from "@/server/checkout/stripe";

export function adminJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie",
    ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}

export async function adminRequest(request: Request) {
  if (request.method !== "GET" && (request.headers.get("origin") !== checkoutOrigin() ||
      request.headers.get("sec-fetch-site") === "cross-site")) {
    return { response: adminJson({ error: "Use the website directly." }, 403) };
  }
  const admin = await getAdmin();
  if (!admin) return { response: adminJson({ error: "Owner access required." }, 403) };
  const bucket = Math.floor(Date.now() / 60000);
  const key = createHash("sha256").update(`admin:${admin.id}:${bucket}`).digest("hex");
  const [limit] = await db().insert(checkoutLimits).values({ key, expiresAt: new Date((bucket + 1) * 60000) })
    .onConflictDoUpdate({ target: checkoutLimits.key, set: { count: sql`${checkoutLimits.count} + 1` } }).returning();
  if (limit.count > 30) return { response: adminJson({ error: "Please wait a minute before trying again." }, 429) };
  return { admin };
}

/** Bound both memory and time spent reading uploads. */
export async function adminBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("Expected JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty request.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("Upload timed out.")); }, 10000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2900000) { void reader.cancel().catch(() => {}); throw new Error("Photo is too large. Maximum input: 2 MB."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
