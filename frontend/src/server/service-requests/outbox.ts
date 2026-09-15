import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { checkoutLimits, officeEmailJobs, serviceRequests, type OfficeEmailPayload } from "@/server/db/schema";
import { sendOfficeEmail } from "@/server/lib/mailer";

type ClaimedJob = { id: string; reference: string; kind: string; payload: OfficeEmailPayload; attempts: number; first_attempt_at: string | Date };

export async function runOfficeOutbox(reference?: string) {
  const token = randomUUID();
  const filter = reference ? sql`AND reference = ${reference}` : sql``;
  const result = await db().execute(sql`
    UPDATE office_email_jobs SET status = 'sending', lock_token = ${token},
      locked_until = now() + interval '2 minutes', attempts = attempts + 1,
      first_attempt_at = COALESCE(first_attempt_at, now())
    WHERE id IN (
      SELECT id FROM office_email_jobs
      WHERE ((status = 'pending' AND next_attempt_at <= now()) OR (status = 'sending' AND locked_until < now()))
      ${filter} ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 4
    ) RETURNING *
  `);
  let sent = 0, failed = 0;
  for (const job of result.rows as unknown as ClaimedJob[]) {
    const owned = and(eq(officeEmailJobs.id, job.id), eq(officeEmailJobs.lockToken, token));
    // Resend's idempotency window is 24h. Never risk an ambiguous duplicate after it.
    const stale = Date.now() - new Date(job.first_attempt_at).getTime() >= 23 * 3600000;
    const delivery = stale ? { delivered: false, permanent: true, reason: "manual-review-idempotency-window" }
      : await sendOfficeEmail(job.payload, `office-${job.id}`);
    if (delivery.delivered) {
      await db().update(officeEmailJobs).set({ status: "sent", sentAt: new Date(), lockedUntil: null, lockToken: null, lastError: null }).where(owned);
      if (job.kind === "desk") await db().update(serviceRequests).set({ notifiedAt: new Date() }).where(eq(serviceRequests.reference, job.reference));
      sent++;
    } else {
      const terminal = delivery.permanent || job.attempts >= 12;
      await db().update(officeEmailJobs).set({ status: terminal ? "failed" : "pending", lastError: delivery.reason,
        nextAttemptAt: new Date(Date.now() + Math.min(3600, 60 * 2 ** Math.min(job.attempts - 1, 6)) * 1000),
        lockedUntil: null, lockToken: null }).where(owned);
      console.error("office_email_retry", { jobId: job.id, code: delivery.reason, terminal });
      failed++;
    }
  }
  // Only expiring counters are cleaned up; business records are retained.
  await db().delete(checkoutLimits).where(lt(checkoutLimits.expiresAt, new Date()));
  return { processed: result.rows.length, sent, failed };
}
