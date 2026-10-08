import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/server/checkout/stripe";
import { syncCheckout } from "@/server/checkout/fulfill";
import { limitedBody } from "@/server/checkout/http";
import { syncTheatreSubscription } from "@/server/theatre/membership";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await limitedBody(request, 256000), request.headers.get("stripe-signature") || "", secret);
  } catch { return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 }); }
  if (event.livemode) return NextResponse.json({ error: "Test events only." }, { status: 400 });
  if (process.env.THEATRE_ENABLED === "true") {
    try {
      if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        await syncTheatreSubscription((event.data.object as Stripe.Subscription).id);
      } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
        const invoice = event.data.object as Stripe.Invoice;
        const subscription = invoice.parent?.subscription_details?.subscription;
        const id = typeof subscription === "string" ? subscription : subscription?.id;
        if (id) await syncTheatreSubscription(id);
      } else if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.integration === "continental-theatre-v1") {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
          if (id) await syncTheatreSubscription(id);
        }
      }
    } catch {
      return NextResponse.json({ error: "Membership synchronization requires a retry." }, { status: 500 });
    }
  }
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"].includes(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    // Ignore checkouts belonging to other integrations on this Stripe account.
    if (session.metadata?.integration === "continental-merch-v1" && session.metadata?.orderId) {
      try { await syncCheckout(session.id); }
      catch {
        console.error("Order webhook processing failed; Stripe should retry delivery.");
        return NextResponse.json({ error: "Order processing requires a retry." }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ received: true });
}
