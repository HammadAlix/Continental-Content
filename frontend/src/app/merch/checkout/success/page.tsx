"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MERCH_CART_KEY } from "@/lib/merch";
import { checkoutMoney } from "@/lib/checkout";

type Receipt = { reference: string; status: string; total: number; shipping: number; items: { productId: string; name: string; size: string; quantity: number; unitAmount: number }[] };

export default function SuccessPage() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    const sessionId = new URLSearchParams(location.search).get("session_id");
    async function verify() {
      try {
        if (!sessionId) throw new Error("Missing checkout reference. Please return to the wardrobe.");
        const response = await fetch("/api/checkout/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not verify payment yet.");
        if (controller.signal.aborted) return;
        setReceipt(data); setError("");
        if (data.status === "paid") {
          try {
            const purchased = sessionStorage.getItem(`merch-purchase:${sessionId}`);
            // Only clear an unchanged bag, never items added after checkout began.
            const current = localStorage.getItem(MERCH_CART_KEY);
            if (purchased && current && purchased === JSON.stringify(JSON.parse(current))) localStorage.removeItem(MERCH_CART_KEY);
            sessionStorage.removeItem(`merch-purchase:${sessionId}`);
          } catch { /* Receipt still works with storage disabled. */ }
        } else if (data.status === "pending" && ++polls < 8) timer = setTimeout(verify, 3000);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Please retry confirmation."); }
    }
    void verify();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [retry]);

  return <main className="checkout-shell checkout-receipt"><p className="checkout-eyebrow">Continental Content · Test receipt</p>
    <h1>{receipt?.status === "paid" ? "Your test order is confirmed." : receipt?.status === "expired" ? "This checkout has expired." : "Confirming your payment…"}</h1>
    <div className="checkout-test">TEST MODE · No real payment or shipment.</div>
    <section className="checkout-card" aria-live="polite">
      {error ? <p role="alert" className="checkout-error">{error}</p> : receipt ? <>
        <p className="checkout-small">Order reference: {receipt.reference}</p>
        {receipt.status !== "paid" && <p>Payment has not been confirmed. Do not pay again while confirmation is pending.</p>}
        {receipt.items.map((item) => <div className="checkout-line" key={`${item.productId}:${item.size}`}><span>{item.name}<small>Size {item.size} · Quantity {item.quantity}</small></span><strong>{checkoutMoney(item.unitAmount * item.quantity)}</strong></div>)}
        <div className="checkout-line"><span>Delivery (sample)</span><strong>{checkoutMoney(receipt.shipping)}</strong></div>
        <div className="checkout-line"><strong>Total · USD</strong><strong>{checkoutMoney(receipt.total)}</strong></div>
        {receipt.status === "paid" && <p className="checkout-small">Your test order is saved. Confirmation emails are handled by the Stripe webhook once connected.</p>}
      </> : <p>Checking securely with Stripe…</p>}
      {(error || receipt?.status === "pending") && <button className="checkout-button" onClick={() => { setError(""); setRetry((value) => value + 1); }}>Check again</button>}
      <Link className="checkout-back" href="/merch">Return to the wardrobe →</Link>
    </section>
  </main>;
}
