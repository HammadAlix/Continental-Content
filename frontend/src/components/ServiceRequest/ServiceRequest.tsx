"use client";

import { useId, useRef, useState } from "react";
import { SERVICES } from "@/lib/services";
import "./ServiceRequest.css";

type Errors = Record<string, string>;
type Status = "idle" | "sending" | "sent";

const EMPTY = {
  name: "",
  email: "",
  services: [] as string[],
  details: "",
  courtesy: "",
};

export default function ServiceRequest() {
  const fieldId = useId();
  const submitting = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const selected = SERVICES.filter((service) => values.services.includes(service.id));

  const update = (field: Exclude<keyof typeof EMPTY, "services">, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    // Clear the field's error as soon as it's touched — leaving it up while
    // someone is fixing it just nags.
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  const toggleService = (id: string) => {
    setValues((previous) => ({
      ...previous,
      // Stable catalogue order keeps retries identical regardless of click order.
      services: SERVICES.filter((service) => service.id === id
        ? !previous.services.includes(id)
        : previous.services.includes(service.id)).map((service) => service.id),
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next.service;
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;

    setStatus("sending");
    setFailure(null);

    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
      const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!attempt.current) {
        try { attempt.current = JSON.parse(sessionStorage.getItem("office-submission-attempt") || "null"); } catch { /* In-memory fallback. */ }
      }
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
      try { sessionStorage.setItem("office-submission-attempt", JSON.stringify(attempt.current)); } catch { /* In-memory fallback. */ }
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(20000),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409) {
          attempt.current = null;
          try { sessionStorage.removeItem("office-submission-attempt"); } catch { /* Optional storage. */ }
        }
        setErrors(data.errors ?? {});
        setFailure(
          data.errors ? null : (data.error ?? "The desk didn't take it.")
        );
        setStatus("idle");
        return;
      }

      setReference(data.reference ?? null);
      setStatus("sent");
    } catch {
      // Offline, blocked, or the server never answered.
      setFailure("Couldn't reach the desk. Try again in a moment.");
      setStatus("idle");
    } finally {
      submitting.current = false;
    }
  };

  if (status === "sent") {
    return (
      <div className="service-request is-sent" role="status">
        <span className="service-request-eyebrow">Received</span>
        <h2 className="service-request-title">Your request is on the desk</h2>
        <p className="service-request-lede">
          Someone reads everything left here. If it warrants a reply, one comes
          to the address you gave.
        </p>

        {reference && (
          <p className="service-request-reference">
            <span>Reference</span>
            <strong>{reference}</strong>
          </p>
        )}

        <button
          type="button"
          className="service-request-again"
          onClick={() => {
            attempt.current = null;
            try { sessionStorage.removeItem("office-submission-attempt"); } catch { /* Optional storage. */ }
            setValues(EMPTY);
            setReference(null);
            setStatus("idle");
          }}
        >
          Leave another
        </button>
      </div>
    );
  }

  return (
    <form className="service-request" onSubmit={submit} noValidate>
      <span className="service-request-eyebrow">Concierge</span>
      <h2 className="service-request-title">Request service</h2>
      <p className="service-request-lede">
        The desk is unattended. Write down what you need and leave it where it
        will be found.
      </p>

      <div className="service-request-field">
        <label htmlFor={`${fieldId}-name`}>Name</label>
        <input
          id={`${fieldId}-name`}
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && (
          <span className="service-request-error">{errors.name}</span>
        )}
      </div>

      <div className="service-request-field">
        <label htmlFor={`${fieldId}-email`}>Email</label>
        <input
          id={`${fieldId}-email`}
          type="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email && (
          <span className="service-request-error">{errors.email}</span>
        )}
      </div>

      <fieldset className="service-request-services" disabled={status === "sending"}
        aria-describedby={`${fieldId}-services-help${errors.service ? ` ${fieldId}-services-error` : ""}`}>
        <legend>Nature of business</legend>
        <span id={`${fieldId}-services-help`} className="service-request-note">Select one or more. Click again to deselect.</span>
        <div className="service-request-options">
          {SERVICES.map((service) => (
            <label
              key={service.id}
              className={`service-request-option${
                values.services.includes(service.id) ? " is-selected" : ""
              }`}
            >
              <input
                type="checkbox"
                name="services"
                value={service.id}
                checked={values.services.includes(service.id)}
                onChange={() => toggleService(service.id)}
                aria-invalid={Boolean(errors.service)}
              />
              {service.label}
            </label>
          ))}
        </div>
        {/* Reserves its own line whether or not anything is selected, so
            picking an option doesn't shunt the rest of the form downward. */}
        <span className="service-request-note" aria-live="polite">{selected.length > 1 ? `${selected.length} services selected.` : selected[0]?.note ?? " "}</span>
        {errors.service && (
          <span id={`${fieldId}-services-error`} className="service-request-error">{errors.service}</span>
        )}
      </fieldset>

      <div className="service-request-field">
        <label htmlFor={`${fieldId}-details`}>Details</label>
        <textarea
          id={`${fieldId}-details`}
          rows={3}
          value={values.details}
          onChange={(e) => update("details", e.target.value)}
          aria-invalid={Boolean(errors.details)}
        />
        {errors.details && (
          <span className="service-request-error">{errors.details}</span>
        )}
      </div>

      {/* Honeypot: off-screen and hidden from assistive tech, so only a bot
          filling every input it finds will ever answer it. */}
      <div className="service-request-courtesy" aria-hidden="true">
        <label htmlFor={`${fieldId}-courtesy`}>Leave this empty</label>
        <input
          id={`${fieldId}-courtesy`}
          tabIndex={-1}
          autoComplete="off"
          value={values.courtesy}
          onChange={(e) => update("courtesy", e.target.value)}
        />
      </div>

      {failure && (
        <p className="service-request-failure" role="alert">
          {failure}
        </p>
      )}

      <button
        type="submit"
        className="service-request-submit"
        disabled={status === "sending"}
      >
        {status === "sending" ? "Leaving it…" : "Leave it on the desk"}
      </button>
    </form>
  );
}
