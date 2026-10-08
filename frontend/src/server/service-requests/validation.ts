import { SERVICES, isServiceId } from "@/lib/services";

/**
 * Validation for an incoming service request.
 *
 * Deliberately free of any framework: it takes an unknown object and returns
 * either a clean value or a map of field errors. Nothing here knows it was
 * called by an HTTP handler, which is what lets the same rules run from a
 * script, a test, or a different server later.
 */

export const LIMITS = {
  name: { min: 2, max: 80 },
  email: { max: 160 },
  details: { min: 10, max: 2000 },
} as const;

// Deliberately permissive. Anything stricter starts rejecting real addresses,
// and the only real proof an address works is sending to it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CleanServiceRequest {
  name: string;
  email: string;
  /** Canonical comma-separated catalogue IDs; a single choice keeps its old value/hash. */
  service: string;
  details: string;
}

export type FieldErrors = Record<string, string>;

export type Validated =
  | { ok: true; value: CleanServiceRequest; honeypot: boolean }
  | { ok: false; errors: FieldErrors };

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export function validateServiceRequest(input: unknown): Validated {
  const payload = (input ?? {}) as Record<string, unknown>;

  const name = asText(payload.name);
  const email = asText(payload.email).toLowerCase();
  // Accept old single-choice tabs, but never fall back from a malformed new array.
  const choices = payload.services === undefined ? [asText(payload.service)] : payload.services;
  const validChoices = Array.isArray(choices) && choices.length > 0 && choices.length <= SERVICES.length &&
    choices.every((choice) => typeof choice === "string" && isServiceId(choice));
  const service = validChoices
    ? SERVICES.filter((entry) => choices.includes(entry.id)).map((entry) => entry.id).join(",")
    : "";
  const details = asText(payload.details);

  // Hidden field, invisible to people and irresistible to naive bots. Reported
  // rather than rejected here — the caller decides what to do with a bot, and
  // the honest answer is usually "accept it and drop it on the floor".
  const honeypot = Boolean(asText(payload.courtesy));

  const errors: FieldErrors = {};

  if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
    errors.name = `Between ${LIMITS.name.min} and ${LIMITS.name.max} characters.`;
  }

  if (!EMAIL.test(email) || email.length > LIMITS.email.max) {
    errors.email = "A reachable email address, please.";
  }

  if (!validChoices || (payload.services !== undefined && payload.service !== undefined)) {
    errors.service = "Choose one or more of the listed services.";
  }

  if (
    details.length < LIMITS.details.min ||
    details.length > LIMITS.details.max
  ) {
    errors.details = `Between ${LIMITS.details.min} and ${LIMITS.details.max} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { name, email, service, details }, honeypot };
}

/** Short, unambiguous, and speakable over a phone — no 0/O or 1/I. */
export function newReference() {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY2345789";
  let body = "";

  for (let i = 0; i < 6; i++) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return `CC-${body}`;
}
