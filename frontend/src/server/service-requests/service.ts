import "server-only";

import { SERVICES } from "@/lib/services";
import { confirmVisitor, notifyDesk } from "@/server/lib/mailer";
import { checkRateLimit, hashIp } from "@/server/lib/rate-limit";
import * as repository from "./repository";
import {
  newReference,
  validateServiceRequest,
  type FieldErrors,
} from "./validation";

/**
 * Submitting a request left at the desk.
 *
 * This is the whole business rule in one place, and it imports nothing from
 * Next — it takes a plain object and returns a plain result. The route handler
 * translates that into HTTP; a script or a different framework could call it
 * just as well.
 */

export type SubmitResult =
  | { status: "ok"; reference: string }
  | { status: "invalid"; errors: FieldErrors }
  | { status: "rate-limited"; retryAfter?: number }
  | { status: "failed"; reason: string };

export interface SubmitContext {
  ip?: string;
  userAgent?: string;
}

export async function submitServiceRequest(
  input: unknown,
  context: SubmitContext = {}
): Promise<SubmitResult> {
  const validated = validateServiceRequest(input);

  if (!validated.ok) {
    return { status: "invalid", errors: validated.errors };
  }

  // A bot gets a normal-looking success and goes no further. Telling it that
  // it was caught only teaches whoever wrote it to stop filling the field.
  if (validated.honeypot) {
    return { status: "ok", reference: newReference() };
  }

  const ipHash = context.ip ? await hashIp(context.ip) : undefined;

  if (ipHash) {
    const limit = await checkRateLimit(`service-request:${ipHash}`);
    if (!limit.allowed) {
      return { status: "rate-limited", retryAfter: limit.retryAfter };
    }
  }

  const reference = newReference();
  const { name, email, service, details } = validated.value;

  // Stored before anything else. The row is the record; the email is only a
  // notification about it. If delivery fails the request still exists, which is
  // the entire reason for having a database here.
  try {
    await repository.save({
      reference,
      name,
      email,
      service,
      details,
      ipHash,
      userAgent: context.userAgent,
    });
  } catch (error) {
    console.error("[service-request] save failed", { reference, error });
    return { status: "failed", reason: "storage" };
  }

  const label = SERVICES.find((entry) => entry.id === service)?.label ?? service;

  // Deliberately not awaited into the response path — see the caller. A slow
  // mail provider must not become the visitor's wait.
  const [notified] = await Promise.all([
    notifyDesk({
    subject: `Service request ${reference} — ${label}`,
    replyTo: email,
    text: [
      `Reference: ${reference}`,
      `Name:      ${name}`,
      `Email:     ${email}`,
      `Service:   ${label}`,
      "",
      details,
    ].join("\n"),
    }),
    confirmVisitor({ name, email, reference, service: label }),
  ]);

  if (notified.delivered) {
    // Best effort: the request is already safe, so a failed stamp is a
    // reporting inaccuracy rather than lost business.
    await repository.markNotified(reference).catch((error) => {
      console.error("[service-request] markNotified failed", {
        reference,
        error,
      });
    });
  }

  return { status: "ok", reference };
}
