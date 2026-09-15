import { after, NextResponse } from "next/server";
import { submitServiceRequest } from "@/server/service-requests/service";
import { officeClientIp, readOfficeBody, RequestError, verifyOfficeRequest } from "@/server/service-requests/http";
import { consumeLimit } from "@/server/lib/rate-limit";
import { runOfficeOutbox } from "@/server/service-requests/outbox";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request: Request) {
  try {
    const submissionKey = verifyOfficeRequest(request);
    const ip = officeClientIp(request);
    const ingress = await consumeLimit(`ingress:${ip}`, 60, 30);
    if (!ingress.allowed) return json({ error: "Too many attempts. Please wait before trying again." }, 429, { "Retry-After": String(ingress.retryAfter) });
    const body = await readOfficeBody(request);
    const result = await submitServiceRequest(body, { ip, submissionKey, userAgent: request.headers.get("user-agent") ?? undefined });
    switch (result.status) {
      case "ok":
        // Next keeps this work alive after responding; the scheduled worker recovers crashes.
        after(async () => {
          try { await runOfficeOutbox(result.reference); }
          catch { console.error("office_email_worker_failed", { reference: result.reference }); }
        });
        return json({ reference: result.reference });
      case "invalid": return json({ errors: result.errors }, 400);
      case "conflict": return json({ error: "This submission key belongs to different details. Please submit again." }, 409);
      case "rate-limited": return json({ error: "Too many requests. Please try again later." }, 429, { "Retry-After": String(result.retryAfter || 3600) });
      case "failed": return json({ error: "The desk is temporarily unavailable. Please try again shortly." }, 503);
    }
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("office_submission_failed"); // No request bodies, secrets or customer details in logs.
    return json({ error: "The desk is temporarily unavailable. Please try again shortly." }, 503);
  }
}
