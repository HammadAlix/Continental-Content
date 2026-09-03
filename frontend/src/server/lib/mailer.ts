import "server-only";

/**
 * Outbound email.
 *
 * NOT YET SENDING. Until RESEND_API_KEY and the addresses are set, messages are
 * logged and reported as not-delivered, so the rest of the flow can be built
 * and tested without a verified domain.
 *
 * When it is wired up, the one rule that matters: send `from` a domain you
 * control and put the visitor's address in `replyTo`. Sending `from` the
 * visitor's address fails SPF/DKIM and lands the mail in spam — or gets your
 * domain flagged.
 */

export interface Message {
  to: string;
  subject: string;
  /** Plain text only. Nothing here escapes user input for HTML. */
  text: string;
  replyTo?: string;
}

export function notifyDesk(message: Omit<Message, "to">): Promise<SendResult> {
  return send({ ...message, to: process.env.SERVICE_REQUEST_TO ?? "" });
}

export function confirmVisitor(input: {
  name: string;
  email: string;
  reference: string;
  service: string;
}): Promise<SendResult> {
  return send({
    to: input.email,
    replyTo: process.env.SERVICE_REQUEST_TO,
    subject: `We received your request - ${input.reference}`,
    text: [
      `Hello ${input.name},`,
      "",
      "Your request has been received by the Continental Content desk.",
      `Reference: ${input.reference}`,
      `Service: ${input.service}`,
      "",
      "If your request warrants a reply, it will come from this address.",
      "",
      "Continental Content",
    ].join("\n"),
  });
}

export interface SendResult {
  delivered: boolean;
  reason?: string;
}

const configured = () =>
  Boolean(
    process.env.RESEND_API_KEY &&
      process.env.SERVICE_REQUEST_TO &&
      process.env.SERVICE_REQUEST_FROM
  );

async function send(message: Message): Promise<SendResult> {
  if (!configured()) {
    console.info("[mailer] not configured, would have sent:", {
      to: message.to,
      subject: message.subject,
      replyTo: message.replyTo,
    });
    return { delivered: false, reason: "mailer-not-configured" };
  }

  // TODO: Resend send() — from SERVICE_REQUEST_FROM, to SERVICE_REQUEST_TO,
  // replyTo the visitor.
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.SERVICE_REQUEST_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[mailer] provider rejected message", {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      return { delivered: false, reason: `provider-${response.status}` };
    }

    return { delivered: true };
  } catch (error) {
    console.error("[mailer] delivery failed", { error });
    return { delivered: false, reason: "network" };
  }
}
