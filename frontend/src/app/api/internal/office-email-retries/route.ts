import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOfficeOutbox } from "@/server/service-requests/outbox";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runOfficeOutbox(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("office_email_retry_worker_failed");
    return NextResponse.json({ error: "Retry worker unavailable." }, { status: 503 });
  }
}
