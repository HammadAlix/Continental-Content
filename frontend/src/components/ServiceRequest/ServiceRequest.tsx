"use client";

import { useId, useState } from "react";
import { SERVICES } from "@/lib/services";
import "./ServiceRequest.css";

type Errors = Record<string, string>;
type Status = "idle" | "sending" | "sent";

const EMPTY = {
  name: "",
  email: "",
  service: "",
  details: "",
  courtesy: "",
};

export default function ServiceRequest() {
  const fieldId = useId();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const selected = SERVICES.find((service) => service.id === values.service);

  const update = (field: keyof typeof EMPTY, value: string) => {
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;

    setStatus("sending");
    setFailure(null);

    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
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

      <fieldset className="service-request-services">
        <legend>Nature of business</legend>
        <div className="service-request-options">
          {SERVICES.map((service) => (
            <label
              key={service.id}
              className={`service-request-option${
                values.service === service.id ? " is-selected" : ""
              }`}
            >
              <input
                type="radio"
                name="service"
                value={service.id}
                checked={values.service === service.id}
                onChange={(e) => update("service", e.target.value)}
              />
              {service.label}
            </label>
          ))}
        </div>
        {/* Reserves its own line whether or not anything is selected, so
            picking an option doesn't shunt the rest of the form downward. */}
        <span className="service-request-note">{selected?.note ?? " "}</span>
        {errors.service && (
          <span className="service-request-error">{errors.service}</span>
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
