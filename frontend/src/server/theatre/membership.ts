import "server-only";
import { eq, and, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/server/db/client";
import { theatreMembers, theatreSubscriptions } from "@/server/db/schema";
import { stripe } from "@/server/checkout/stripe";
import { hasTheatreEntitlement } from "@/lib/theatre";
import { subscriptionEntitlement, THEATRE_INTEGRATION } from "./subscription-policy";

async function saveSubscription(subscription: Stripe.Subscription, member: { userId: string; customerId: string }, checkedAt: Date) {
  const state = subscriptionEntitlement(subscription, member.customerId, member.userId);
  const saved = await db().insert(theatreSubscriptions).values({ id: subscription.id, userId: member.userId, customerId: member.customerId, ...state, syncedAt: checkedAt })
    .onConflictDoUpdate({ target: theatreSubscriptions.id, set: { ...state, syncedAt: checkedAt },
      setWhere: lte(theatreSubscriptions.syncedAt, checkedAt) }).returning({ id: theatreSubscriptions.id });
  // A newer reconciliation won the race. Never authorize using the discarded older response.
  if (!saved.length) throw new Error("Membership changed during verification. Please retry.");
  return state;
}

export async function syncTheatreSubscription(id: string) {
  const checkedAt = new Date();
  const subscription = await stripe().subscriptions.retrieve(id, { expand: ["latest_invoice"] });
  if (subscription.metadata.integration !== THEATRE_INTEGRATION) return;
  const [member] = await db().select().from(theatreMembers).where(eq(theatreMembers.userId, subscription.metadata.userId || ""));
  if (!member?.customerId) throw new Error("Membership mapping not ready.");
  return saveSubscription(subscription, { userId: member.userId, customerId: member.customerId }, checkedAt);
}

const emptySummary = () => ({ active: false, paidThrough: null as Date | null, hasSubscription: false });
export const MEMBERSHIP_SNAPSHOT_MS = 60000;
const terminal = (status: string) => ["canceled", "incomplete_expired"].includes(status);

/** Fresh billing/checkout-return reconciliation. One expanded list, no repeated retrieves. */
export async function getMembershipDetails(userId: string) {
  const result = { ...emptySummary(), cancelAtPeriodEnd: false };
  if (process.env.THEATRE_ENABLED !== "true") return result;
  const [member] = await db().select().from(theatreMembers).where(eq(theatreMembers.userId, userId));
  if (!member?.customerId) return result;
  const client = stripe();
  let startingAfter: string | undefined;
  do {
    const checkedAt = new Date();
    const page = await client.subscriptions.list({ customer: member.customerId, status: "all", limit: 100,
      expand: ["data.latest_invoice"], ...(startingAfter ? { starting_after: startingAfter } : {}) });
    for (const subscription of page.data) {
      if (subscription.metadata.integration !== THEATRE_INTEGRATION || subscription.metadata.userId !== userId) continue;
      const state = await saveSubscription(subscription, { userId, customerId: member.customerId }, checkedAt);
      if (!terminal(subscription.status)) {
        result.hasSubscription = true;
        result.cancelAtPeriodEnd ||= subscription.cancel_at_period_end;
      }
      if (hasTheatreEntitlement(state)) {
        result.active = true;
        if (!result.paidThrough || state.paidThrough! > result.paidThrough) result.paidThrough = state.paidThrough;
      }
    }
    if (!page.has_more) break;
    const last = page.data.at(-1)?.id;
    if (!last || last === startingAfter) throw new Error("Subscription reconciliation incomplete.");
    startingAfter = last;
  } while (true);
  return result;
}

/** Navigation/previews only. Never use this snapshot to issue video/DRM playback tokens. */
export async function getMembershipSnapshot(userId: string) {
  if (process.env.THEATRE_ENABLED !== "true") return emptySummary();
  const rows = await db().select().from(theatreSubscriptions).where(and(eq(theatreSubscriptions.userId, userId), eq(theatreSubscriptions.livemode, false)));
  const now = Date.now();
  const fresh = rows.length > 0 && rows.every(row => {
    const checkedAt = row.syncedAt?.getTime();
    return Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt < MEMBERSHIP_SNAPSHOT_MS;
  });
  if (!fresh) {
    // Also discovers a checkout whose redirect arrived before its webhook.
    // Never use an old positive snapshot if the provider is unavailable.
    const { active, paidThrough, hasSubscription } = await getMembershipDetails(userId);
    return { active, paidThrough, hasSubscription };
  }
  const entitled = rows.find(row => hasTheatreEntitlement(row));
  return { active: Boolean(entitled), paidThrough: entitled?.paidThrough ?? null,
    hasSubscription: rows.some(row => !terminal(row.status)) };
}

/** Always fresh. Required for issuing/renewing video and DRM playback tokens. */
export async function getMembership(userId: string) {
  if (process.env.THEATRE_ENABLED !== "true") return { active: false, paidThrough: null };
  const rows = await db().select().from(theatreSubscriptions).where(and(eq(theatreSubscriptions.userId, userId), eq(theatreSubscriptions.livemode, false)));
  // Reconcile directly before issuing access: delayed/out-of-order webhooks
  // cannot make a canceled subscription playable. Provider failure fails closed.
  for (const row of rows) {
    if (row.status === "canceled") continue;
    const fresh = await syncTheatreSubscription(row.id);
    if (fresh && hasTheatreEntitlement(fresh)) return { active: true, paidThrough: fresh.paidThrough };
  }
  return { active: false, paidThrough: null };
}
