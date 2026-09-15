import "server-only";
import Stripe from "stripe";

export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("Stripe test checkout is not configured.");
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 });
}

export function checkoutOrigin() {
  const configured = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const url = new URL(configured);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("APP_URL must be the website origin.");
  return url.origin;
}
