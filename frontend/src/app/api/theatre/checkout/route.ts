import { theatreRequest, theatreJson } from "@/server/theatre/http";
import { createMembershipCheckout } from "@/server/theatre/checkout";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const result = await theatreRequest(request, "checkout", 5);
    if (result.response) return result.response;
    if (!process.env.MUX_SIGNING_KEY || !process.env.MUX_PRIVATE_KEY || !process.env.MUX_DRM_CONFIGURATION_ID) {
      return theatreJson({ error: "Protected playback setup must be completed before subscriptions open." }, 503);
    }
    if (!process.env.STRIPE_WEBHOOK_SECRET) return theatreJson({ error: "Subscription webhooks are not configured." }, 503);
    return theatreJson({ url: await createMembershipCheckout(result.member.id) });
  } catch {
    return theatreJson({ error: "Checkout could not be confirmed. Refresh membership before trying again; an existing checkout will be reused where possible." }, 503);
  }
}
