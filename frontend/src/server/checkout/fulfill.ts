import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { merchOrders } from "@/server/db/schema";
import { checkoutMoney } from "@/lib/checkout";
import { stripe } from "./stripe";

type Order = typeof merchOrders.$inferSelect;

async function notify(order: Order, recipient: "customer" | "desk") {
  if (recipient === "customer" ? order.customerNotifiedAt : order.deskNotifiedAt) return;
  const to = recipient === "customer" ? order.email : process.env.SERVICE_REQUEST_TO;
  const from = process.env.SERVICE_REQUEST_FROM;
  const key = process.env.RESEND_API_KEY;
  if (!to || !from || !key) throw new Error("Order email is not configured.");
  const delivery = order.delivery;
  const address = delivery?.address;
  const lines = order.items.map((item) => `${item.quantity} x ${item.name} / ${item.size} - ${checkoutMoney(item.unitAmount * item.quantity)}`);
  const text = ["TEST ORDER - no real payment or shipment", `Order: ${order.id}`, "", ...lines,
    `Delivery (sample): ${checkoutMoney(order.shipping)}`, `Total: ${checkoutMoney(order.total)} USD`,
    "Tax is not configured for test orders.", "", "Delivery details:", delivery?.name,
    address && [address.line1, address.line2, address.city, address.state, address.postal_code, address.country].filter(Boolean).join(", "),
    recipient === "desk" ? `Customer: ${order.email}` : "Thank you for testing the Continental wardrobe. This is a test confirmation, not a fulfilment request.",
  ].filter(Boolean).join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `merch-${order.id}-${recipient}` },
    body: JSON.stringify({ from, to: [to], subject: `[TEST] Continental order ${order.id.slice(0, 8)}`, text,
      reply_to: recipient === "desk" ? order.email : process.env.SERVICE_REQUEST_TO }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Order email delivery failed.");
  await db().update(merchOrders).set(recipient === "customer" ? { customerNotifiedAt: new Date() } : { deskNotifiedAt: new Date() }).where(eq(merchOrders.id, order.id));
}

// Used by both the signed webhook and the return page. Never trust URL/payment flags.
// Always retrieve payment state directly from Stripe; replayed events are harmless.
export async function syncCheckout(sessionId: string, sendEmails = true) {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.livemode || session.mode !== "payment" || session.metadata?.integration !== "continental-merch-v1" || !session.metadata?.orderId) throw new Error("Invalid checkout session.");
  const [order] = await db().select().from(merchOrders).where(eq(merchOrders.id, session.metadata.orderId));
  if (!order || (order.stripeSessionId && order.stripeSessionId !== session.id) || session.client_reference_id !== order.id || session.currency !== "usd" || session.amount_total !== order.total || session.amount_subtotal !== order.subtotal || session.total_details?.amount_shipping !== order.shipping || session.total_details?.amount_discount !== 0 || session.total_details?.amount_tax !== 0) throw new Error("Order does not match Stripe checkout.");
  if (session.payment_status === "paid" && session.status === "complete") {
    const shipping = session.collected_information?.shipping_details;
    if (!session.customer_details?.email || !shipping?.address || shipping.address.country !== "US") throw new Error("Missing order delivery information.");
    await db().update(merchOrders).set({ status: "paid", stripeSessionId: session.id, paidAt: order.paidAt || new Date(), email: session.customer_details.email, delivery: { name: shipping.name, address: { ...shipping.address } } }).where(eq(merchOrders.id, order.id));
  } else if (session.status === "expired" && order.status !== "paid") {
    await db().update(merchOrders).set({ status: "expired" }).where(eq(merchOrders.id, order.id));
  }
  const [updated] = await db().select().from(merchOrders).where(eq(merchOrders.id, order.id));
  if (updated.status === "paid" && sendEmails) {
    await notify(updated, "customer");
    await notify(updated, "desk");
  }
  // Public receipt intentionally excludes email/address; session ID is an unguessable capability.
  return { reference: updated.id, status: updated.status, items: updated.items, subtotal: updated.subtotal, shipping: updated.shipping, total: updated.total };
}
