import { theatreRequest, theatreJson } from "@/server/theatre/http";
import { getMembershipDetails, getMembershipSnapshot, syncTheatreSubscription } from "@/server/theatre/membership";
import { db } from "@/server/db/client";
import { theatreMembers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/server/checkout/stripe";
import { THEATRE_INTEGRATION } from "@/server/theatre/subscription-policy";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const result = await theatreRequest(request, "membership");
    if (result.response) return result.response;
    const summary = new URL(request.url).searchParams.get("view") === "access"
      ? await getMembershipSnapshot(result.member.id)
      : await getMembershipDetails(result.member.id);
    return theatreJson({ ...summary, testMode: true });
  } catch { return theatreJson({ error: "Membership verification is temporarily unavailable." }, 503); }
}

export async function POST(request: Request) {
  try {
    const result = await theatreRequest(request, "cancel", 5);
    if (result.response) return result.response;
    const [member] = await db().select().from(theatreMembers).where(eq(theatreMembers.userId, result.member.id));
    if (!member?.customerId) return theatreJson({ error: "No membership found." }, 404);
    const client = stripe();
    const subscriptions = await client.subscriptions.list({ customer: member.customerId, status: "all", limit: 100 });
    for (const sub of subscriptions.data) {
      if (sub.metadata.integration !== THEATRE_INTEGRATION || sub.metadata.userId !== member.userId || ["canceled", "incomplete_expired"].includes(sub.status)) continue;
      await client.subscriptions.update(sub.id, { cancel_at_period_end: true });
      await syncTheatreSubscription(sub.id);
    }
    return theatreJson({ cancelled: true });
  } catch { return theatreJson({ error: "Cancellation could not be confirmed. Please retry or contact support." }, 503); }
}
