import "server-only";

/** Missing credentials never create a demo session or unlock content. */
export function isAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

/** A cosmetic local preview only; deployed instances keep provider branding. */
export function hideLocalAuthFooter() {
  return !process.env.VERCEL && process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true;
}
