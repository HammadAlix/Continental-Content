import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { THEATRE_PLAN } from "@/lib/theatre";
import { db } from "@/server/db/client";
import { theatreMembers } from "@/server/db/schema";
import { stripe, checkoutOrigin } from "@/server/checkout/stripe";
import { THEATRE_INTEGRATION } from "./subscription-policy";

export async function createMembershipCheckout(userId: string) {
  const client = stripe(); // Deliberately rejects live keys.
  const database = db();
  const origin = checkoutOrigin();
  await database.insert(theatreMembers).values({ userId, checkoutAttempt: randomUUID() }).onConflictDoNothing();
  let [member] = await database.select().from(theatreMembers).where(eq(theatreMembers.userId, userId));
  if (!member.customerId) {
    if (Date.now() - member.createdAt.getTime() > 23 * 3600000) throw new Error("Customer setup requires review before retrying.");
    const customer = await client.customers.create({ metadata: { integration: THEATRE_INTEGRATION, userId } }, { idempotencyKey: `theatre-customer-${userId}` });
    await database.update(theatreMembers).set({ customerId: customer.id }).where(eq(theatreMembers.userId, userId));
    member = { ...member, customerId: customer.id };
  }
  const customerId = member.customerId!;
  const existing = await client.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  if (existing.has_more || existing.data.some(s => s.metadata.integration === THEATRE_INTEGRATION && !["canceled", "incomplete_expired"].includes(s.status))) {
    throw new Error("An existing membership needs to be managed instead.");
  }
  if (member.checkoutSessionId) {
    const previous = await client.checkout.sessions.retrieve(member.checkoutSessionId);
    if (previous.status === "open" && previous.url) return previous.url;
    if (previous.status === "complete") {
      // Subscription list above is authoritative; if it is still syncing,
      // refuse a second purchase rather than risk duplicate billing.
      const subId = typeof previous.subscription === "string" ? previous.subscription : previous.subscription?.id;
      if (!subId) throw new Error("Previous checkout is still processing.");
      const previousSubscription = await client.subscriptions.retrieve(subId);
      if (!["canceled", "incomplete_expired"].includes(previousSubscription.status)) throw new Error("Previous membership is still processing.");
    }
    const [renewed] = await database.update(theatreMembers).set({ checkoutAttempt: randomUUID(), checkoutSessionId: null, checkoutStartedAt: new Date() })
      .where(and(eq(theatreMembers.userId, userId), eq(theatreMembers.checkoutAttempt, member.checkoutAttempt))).returning();
    if (!renewed) throw new Error("Another checkout is starting; retry shortly.");
    member = renewed;
  }
  // A lost provider response must not be replayed beyond Stripe's idempotency
  // retention. Manual reconciliation is preferable to a duplicate subscription.
  if (Date.now() - member.checkoutStartedAt.getTime() > 23 * 3600000) throw new Error("Checkout setup requires reconciliation.");
  const metadata = { integration: THEATRE_INTEGRATION, userId };
  const session = await client.checkout.sessions.create({
    customer: customerId, mode: "subscription", payment_method_types: ["card"],
    client_reference_id: userId, metadata, subscription_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency: THEATRE_PLAN.currency, unit_amount: THEATRE_PLAN.amount,
      recurring: { interval: THEATRE_PLAN.interval }, product_data: { name: THEATRE_PLAN.name } } }],
    success_url: `${origin}/account/theatre?checkout=returned`, cancel_url: `${origin}/account/theatre?checkout=cancelled`,
    custom_text: { submit: { message: "TEST membership only. $5.99 USD monthly; includes all current and future Theatre videos. No real payment." } },
  }, { idempotencyKey: `theatre-checkout-${member.checkoutAttempt}` });
  if (session.livemode || !session.url) throw new Error("Expected test checkout.");
  await database.update(theatreMembers).set({ checkoutSessionId: session.id }).where(and(eq(theatreMembers.userId, userId), eq(theatreMembers.checkoutAttempt, member.checkoutAttempt)));
  return session.url;
}
