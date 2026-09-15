import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { validateCheckout } from "@/lib/checkout";
import { db } from "@/server/db/client";
import { merchOrders } from "@/server/db/schema";
import { allowCheckoutRequest } from "@/server/checkout/rate-limit";
import { checkoutOrigin, stripe } from "@/server/checkout/stripe";
import { limitedBody } from "@/server/checkout/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const origin = checkoutOrigin();
    if (request.headers.get("origin") !== origin) return NextResponse.json({ error: "Please checkout from the website directly." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
    let orderInput: ReturnType<typeof validateCheckout>;
    try { orderInput = validateCheckout(JSON.parse(await limitedBody(request, 12000))); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid bag." }, { status: 400 }); }
    const client = stripe();
    // Hosted deployments must have a webhook configured before taking checkouts.
    if (process.env.VERCEL && !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "Test checkout is awaiting webhook setup." }, { status: 503 });
    const database = db();
    if (!await allowCheckoutRequest(request, "create")) return NextResponse.json({ error: "Too many checkout attempts. Please try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });
    const cartHash = createHash("sha256").update(JSON.stringify({ items: orderInput.items, total: orderInput.total, origin })).digest("hex");
    await database.insert(merchOrders).values({ id: randomUUID(), ...orderInput, cartHash }).onConflictDoNothing({ target: merchOrders.attemptId });
    const [order] = await database.select().from(merchOrders).where(eq(merchOrders.attemptId, orderInput.attemptId));
    if (order.cartHash !== cartHash) return NextResponse.json({ error: "Your bag changed. Refresh checkout to start a new attempt." }, { status: 409 });
    if (Date.now() - order.createdAt.getTime() > 30 * 60 * 1000 || order.status !== "pending") return NextResponse.json({ error: "This checkout attempt has ended. Refresh to start again." }, { status: 409 });
    const session = order.stripeSessionId ? await client.checkout.sessions.retrieve(order.stripeSessionId) : await client.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: order.id,
      metadata: { orderId: order.id, integration: "continental-merch-v1" },
      line_items: order.items.map((item) => ({ quantity: item.quantity, price_data: { currency: "usd", unit_amount: item.unitAmount, product_data: { name: `${item.name} / ${item.size}`, metadata: { productId: item.productId, size: item.size } } } })),
      shipping_address_collection: { allowed_countries: ["US"] },
      shipping_options: [{ shipping_rate_data: { type: "fixed_amount", fixed_amount: { amount: order.shipping, currency: "usd" }, display_name: "US delivery (sample test rate)" } }],
      custom_text: { submit: { message: "TEST ORDER ONLY. Sample delivery fee. No real payment or shipment. Taxes and stock tracking are not configured for this test." } },
      success_url: `${origin}/merch/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/merch/checkout?cancelled=1`,
      expires_at: Math.floor(order.createdAt.getTime() / 1000) + 61 * 60,
    }, { idempotencyKey: `merch-checkout-${order.id}` });
    if (session.livemode || session.status !== "open" || !session.url) return NextResponse.json({ error: "This checkout is no longer open. Refresh to try again." }, { status: 409 });
    await database.update(merchOrders).set({ stripeSessionId: session.id }).where(eq(merchOrders.id, order.id));
    return NextResponse.json({ url: session.url, sessionId: session.id }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Checkout creation failed; check Stripe test configuration and order database availability.");
    return NextResponse.json({ error: "Checkout is temporarily unavailable. Your bag is saved; please try again shortly." }, { status: 503 });
  }
}
