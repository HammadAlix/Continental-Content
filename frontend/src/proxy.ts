import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { isAuthConfigured } from "@/server/auth/config";

const authenticate = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Office, merch, Stripe webhooks and static media are deliberately untouched.
  if (!isAuthConfigured()) return NextResponse.next();
  return authenticate(request, event);
}

export const config = {
  matcher: ["/", "/foyer", "/sign-in(.*)", "/sign-up(.*)", "/membership(.*)", "/account(.*)", "/admin(.*)", "/theatre(.*)", "/api/theatre(.*)", "/api/admin(.*)", "/api/merch/images(.*)"],
};
