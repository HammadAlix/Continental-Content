"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readMerchCart, type CartLine, type MerchProduct } from "@/lib/merch";
import { checkoutMoney, TEST_SHIPPING_CENTS } from "@/lib/checkout";

export default function MerchCheckout({ products: MERCH_PRODUCTS }: { products: readonly MerchProduct[] }) {
  const [cart, setCart] = useState<CartLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const attempt = useRef("");
  const submitting = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setCart(readMerchCart(MERCH_PRODUCTS));
      setCancelled(new URLSearchParams(location.search).has("cancelled"));
      attempt.current = crypto.randomUUID();
    }, 0);
    return () => clearTimeout(id);
  }, [MERCH_PRODUCTS]);
  const subtotal = (cart || []).reduce((sum, line) => sum + (MERCH_PRODUCTS.find((p) => p.id === line.productId)?.price || 0) * line.quantity, 0);

  async function checkout() {
    if (submitting.current || !cart?.length) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart, attemptId: attempt.current, expectedSubtotal: subtotal }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) attempt.current = crypto.randomUUID();
        throw new Error(data.error || "Could not open checkout.");
      }
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error("Unexpected checkout destination.");
      // Storage may be disabled; it must not prevent payment or confirmation.
      try { sessionStorage.setItem(`merch-purchase:${data.sessionId}`, JSON.stringify(cart)); } catch { /* Bag stays intact. */ }
      location.assign(url.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open checkout. Please try again.");
      submitting.current = false; setBusy(false);
    }
  }

  return <main className="checkout-shell">
    <Link className="checkout-back" href="/merch">← Back to the wardrobe</Link>
    <header><p className="checkout-eyebrow">Continental Content · Guest checkout</p><h1>Your next signature.</h1><p>No account needed. Delivery and payment details are entered securely on Stripe.</p></header>
    <div className="checkout-test">TEST MODE · No real charges or shipments. Use test card details only.</div>
    {cancelled && <p role="status" className="checkout-notice">You returned without completing checkout. Your bag is still here.</p>}
    {cart === null ? <p role="status">Loading your bag…</p> : !cart.length ? <section className="checkout-card"><h2>Your bag is empty.</h2><Link className="checkout-button" href="/merch">Explore the wardrobe</Link></section> : <div className="checkout-grid">
      <section className="checkout-card"><h2>In your bag</h2>{cart.map((line) => {
        const product = MERCH_PRODUCTS.find((p) => p.id === line.productId)!;
        return <article className="checkout-line" key={`${line.productId}:${line.size}`}><div><h3>{product.name}</h3><p>Size {line.size} · Quantity {line.quantity}</p></div><strong>{checkoutMoney(product.price * line.quantity)}</strong></article>;
      })}<Link className="checkout-back" href="/merch">Edit your bag</Link></section>
      <section className="checkout-card"><h2>Order summary</h2><dl className="checkout-totals"><div><dt>Subtotal</dt><dd>{checkoutMoney(subtotal)}</dd></div><div><dt>US delivery (sample)</dt><dd>{checkoutMoney(TEST_SHIPPING_CENTS)}</dd></div><div><dt>Tax</dt><dd>Not configured · test</dd></div><div className="checkout-grand"><dt>Total · USD</dt><dd>{checkoutMoney(subtotal + TEST_SHIPPING_CENTS)}</dd></div></dl>
        <p className="checkout-small">US addresses only for this test. Product prices are set; shipping is a sample rate. Tax and availability must be confirmed before real sales.</p>
        {error && <p className="checkout-error" role="alert">{error}</p>}
        <button className="checkout-button" onClick={checkout} disabled={busy}>{busy ? "Opening secure checkout…" : "Continue to Stripe →"}</button>
        <p className="checkout-small">Stripe collects your email, delivery address and test payment. We never receive your card number.</p>
      </section>
    </div>}
  </main>;
}
