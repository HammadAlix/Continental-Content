import "server-only";
import type { OfficeEmailPayload } from "@/server/db/schema";

export type SendResult = { delivered: boolean; reason?: string; permanent?: boolean };

// Payload is snapshotted when queued so retries use the identical provider request.
export async function sendOfficeEmail(message: OfficeEmailPayload, idempotencyKey: string): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) return { delivered: false, reason: "not-configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text, reply_to: message.replyTo }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { delivered: false, reason: `provider-${response.status}`, permanent: [400, 422].includes(response.status) };
    return { delivered: true };
  } catch { return { delivered: false, reason: "network-or-timeout" }; }
}
