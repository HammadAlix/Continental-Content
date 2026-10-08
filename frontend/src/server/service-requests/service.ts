import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { SERVICES } from "@/lib/services";
import { db } from "@/server/db/client";
import { serviceRequests, type OfficeEmailPayload } from "@/server/db/schema";
import { checkRateLimit, consumeLimit, hashIp } from "@/server/lib/rate-limit";
import { newReference, validateServiceRequest, type FieldErrors } from "./validation";

export type SubmitResult =
  | { status: "ok"; reference: string }
  | { status: "invalid"; errors: FieldErrors }
  | { status: "rate-limited"; retryAfter?: number }
  | { status: "conflict" }
  | { status: "failed"; reason: string };

export async function submitServiceRequest(input: unknown, context: { ip: string; submissionKey: string; userAgent?: string }): Promise<SubmitResult> {
  const validated = validateServiceRequest(input);
  if (!validated.ok) return { status: "invalid", errors: validated.errors };
  if (validated.honeypot) return { status: "ok", reference: newReference() };
  const { name, email, service, details } = validated.value;
  const key = createHash("sha256").update(context.submissionKey).digest("hex");
  const payloadHash = createHash("sha256").update(JSON.stringify(validated.value)).digest("hex");
  const database = db();
  const [existing] = await database.select().from(serviceRequests).where(eq(serviceRequests.submissionKey, key));
  if (existing) return existing.payloadHash === payloadHash ? { status: "ok", reference: existing.reference } : { status: "conflict" };

  const from = process.env.SERVICE_REQUEST_FROM, desk = process.env.SERVICE_REQUEST_TO;
  if (!from || !desk || !process.env.RESEND_API_KEY) return { status: "failed", reason: "mail-configuration" };
  const ipHash = await hashIp(context.ip);
  const ipLimit = await checkRateLimit(`submit:${ipHash}`);
  if (!ipLimit.allowed) return { status: "rate-limited", retryAfter: ipLimit.retryAfter };
  const emailLimit = await consumeLimit(`recipient:${await hashIp(email)}`, 86400, 5);
  if (!emailLimit.allowed) return { status: "rate-limited", retryAfter: emailLimit.retryAfter };

  const reference = `CC-${key.slice(0, 13).toUpperCase()}`;
  const selectedIds = service.split(",");
  const labels = SERVICES.filter((entry) => selectedIds.includes(entry.id)).map((entry) => entry.label);
  const label = labels.join("; ");
  const subjectLabel = labels.length === 1 ? label : `${labels.length} services`;
  const serviceLine = `${labels.length === 1 ? "Service" : "Services"}: ${label}`;
  const messages: { kind: string; payload: OfficeEmailPayload }[] = [
    { kind: "desk", payload: { from, to: desk, replyTo: email, subject: `Service request ${reference} — ${subjectLabel}`,
      text: [`Reference: ${reference}`, `Name: ${name}`, `Email: ${email}`, serviceLine, "", details].join("\n") } },
    { kind: "visitor", payload: { from, to: email, replyTo: desk, subject: `We received your request - ${reference}`,
      text: [`Hello ${name},`, "", "Your request has been received by the Continental Content desk.", `Reference: ${reference}`, serviceLine, "", "If your request warrants a reply, it will come from this address.", "", "Continental Content"].join("\n") } },
  ];
  // One atomic statement. Only a newly inserted request can enqueue its emails.
  // Concurrent retries conflict safely on either unique key and enqueue nothing.
  await database.execute(sql`
    WITH saved AS (
      INSERT INTO service_requests (reference, submission_key, payload_hash, name, email, service, details, ip_hash, user_agent)
      VALUES (${reference}, ${key}, ${payloadHash}, ${name}, ${email}, ${service}, ${details}, ${ipHash}, ${context.userAgent?.slice(0, 512) ?? null})
      ON CONFLICT DO NOTHING RETURNING reference
    )
    INSERT INTO office_email_jobs (id, reference, kind, payload)
    SELECT saved.reference || ':' || message.kind, saved.reference, message.kind, message.payload
    FROM saved CROSS JOIN jsonb_to_recordset(${JSON.stringify(messages)}::jsonb) AS message(kind text, payload jsonb)
  `);
  const [saved] = await database.select().from(serviceRequests).where(eq(serviceRequests.submissionKey, key));
  if (!saved) return { status: "failed", reason: "reference-collision" };
  return saved.payloadHash === payloadHash ? { status: "ok", reference: saved.reference } : { status: "conflict" };
}
