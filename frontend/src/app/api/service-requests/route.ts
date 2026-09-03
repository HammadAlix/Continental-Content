import { NextResponse } from "next/server";
import { submitServiceRequest } from "@/server/service-requests/service";

/**
 * POST /api/service-requests
 *
 * HTTP only: read the request, hand it to the service, turn the result into a
 * status code. All the rules live in server/service-requests, which knows
 * nothing about Next.
 */

/** Nothing legitimate comes close; anything larger is refused before parsing. */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // Behind a proxy the first entry is the client; the rest are the hops.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || undefined;

  const result = await submitServiceRequest(body, {
    ip,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  switch (result.status) {
    case "ok":
      return NextResponse.json({ reference: result.reference });

    case "invalid":
      return NextResponse.json({ errors: result.errors }, { status: 400 });

    case "rate-limited":
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        {
          status: 429,
          ...(result.retryAfter
            ? { headers: { "Retry-After": String(result.retryAfter) } }
            : {}),
        }
      );

    case "failed":
      // The reason is for our logs, not for the caller.
      return NextResponse.json(
        { error: "Couldn't take that just now. Please try again." },
        { status: 500 }
      );
  }
}
