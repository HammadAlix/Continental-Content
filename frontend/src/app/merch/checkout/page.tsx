import Link from "next/link";
import MerchCheckout from "@/components/MerchCheckout/MerchCheckout";
import { getPublicCatalogue } from "@/server/merch/catalogue";

export const dynamic = "force-dynamic";
export default async function CheckoutPage() {
  let products;
  try { products = await getPublicCatalogue(); }
  catch { return <main className="checkout-shell"><h1>Checkout is temporarily unavailable</h1><p>Please refresh shortly. Your saved bag has not been removed.</p><Link href="/merch">Back to store</Link></main>; }
  return <MerchCheckout products={products} />;
}
