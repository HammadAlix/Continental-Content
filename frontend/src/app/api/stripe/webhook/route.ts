import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/server/checkout/stripe";
import { syncCheckout } from "@/server/checkout/fulfill";
import { limitedBody } from "@/server/checkout/http";

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
