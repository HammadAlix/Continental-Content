import type Stripe from "stripe";
import { THEATRE_PLAN } from "@/lib/theatre";

export const THEATRE_INTEGRATION = "continental-theatre-v1";

/** Inspect an expanded, freshly retrieved Stripe subscription, not user input. */
export function subscriptionEntitlement(subscription: Stripe.Subscription, customerId: string, userId: string) {
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (subscription.livemode || customer !== customerId ||
    subscription.metadata.integration !== THEATRE_INTEGRATION || subscription.metadata.userId !== userId) {
    throw new Error("Subscription ownership mismatch.");
  }
  const item = subscription.items.data.length === 1 ? subscription.items.data[0] : null;
  const price = item?.price;
  const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  const validPrice = Boolean(item && item.quantity === 1 && price &&
    price.currency === THEATRE_PLAN.currency && price.unit_amount === THEATRE_PLAN.amount &&
    price.recurring?.interval === THEATRE_PLAN.interval && price.recurring.interval_count === 1);
  // A paid invoice and matching recurring price are both required. A newly
  // generated, unpaid renewal invoice must never advance paid access.
  const paid = Boolean(validPrice && invoice && !invoice.livemode && invoice.status === "paid" &&
    invoice.currency === THEATRE_PLAN.currency && invoice.amount_paid >= THEATRE_PLAN.amount &&
    invoice.amount_remaining === 0);
  const paidThrough = paid && item ? new Date(item.current_period_end * 1000) : null;
  return {
    status: validPrice ? subscription.status : "invalid-plan",
    paidThrough,
    revokedAt: subscription.status === "canceled" || subscription.status === "unpaid" ? new Date() : null,
    livemode: false,
  };
}
