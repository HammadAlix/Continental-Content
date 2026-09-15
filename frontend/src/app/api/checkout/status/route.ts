import { NextResponse } from "next/server";
import { syncCheckout } from "@/server/checkout/fulfill";
import { limitedBody } from "@/server/checkout/http";
import { checkoutOrigin } from "@/server/checkout/stripe";
import { allowCheckoutRequest } from "@/server/checkout/rate-limit";
import { db } from "@/server/db/client";
import { merchOrders } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== checkoutOrigin()) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    let sessionId: unknown;
    try { ({ sessionId } = JSON.parse(await limitedBody(request, 1024))); }
    catch { return NextResponse.json({ error: "Invalid receipt request." }, { status: 400 }); }
    if (typeof sessionId !== "string" || !/^cs_test_[a-zA-Z0-9]{20,240}$/.test(sessionId)) return NextResponse.json({ error: "Invalid checkout reference." }, { status: 400 });
    if (!await allowCheckoutRequest(request, "status")) return NextResponse.json({ error: "Please wait before checking again." }, { status: 429, headers: { "Retry-After": "3600" } });
    const [order] = await db().select({ id: merchOrders.id }).from(merchOrders).where(eq(merchOrders.stripeSessionId, sessionId));
    if (!order) return NextResponse.json({ error: "Checkout reference not found." }, { status: 404 });
    // The webhook owns notification retries; the return page only reconciles payment.
    const receipt = await syncCheckout(sessionId, false);
    return NextResponse.json(receipt, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return NextResponse.json({ error: "We could not verify your order yet. Please retry shortly." }, { status: 503 }); }
}
