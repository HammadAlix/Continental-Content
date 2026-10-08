import "server-only";

/** Missing credentials never create a demo session or unlock content. */
export function isAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

/** Cosmetic only: keep the requested footer appearance on localhost and Vercel. */
export function hideLocalAuthFooter() {
  return true;
}
