"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { THEATRE_PLAN } from "@/lib/theatre";
import "./TheatreMembership.css";

type Membership = { active: boolean; paidThrough: string | null; hasSubscription: boolean; cancelAtPeriodEnd: boolean };

export default function TheatreMembership({ enabled, unavailable = false }: { enabled: boolean; unavailable?: boolean }) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/theatre/membership", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not verify membership.");
    setMembership(body);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/theatre/membership", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not verify membership.");
        if (!controller.signal.aborted) setMembership(body);
      }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [enabled]);

  async function action(kind: "cancel" | "refresh") {
    setBusy(true); setMessage("");
    try {
      if (kind === "refresh") await refresh();
      else {
        if (kind === "cancel" && !window.confirm("Stop monthly renewal? Access continues through the paid period.")) return;
        const response = await fetch("/api/theatre/membership", { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Request failed.");
        await refresh(); setMessage("Renewal cancelled. Your paid access remains until the period ends.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <section className="theatre-membership">
    <p className="member-eyebrow">My Account · Billing & access</p>
    <h1>Manage membership</h1>
    {unavailable && <p role="alert">We could not verify access or load the Theatre. It remains locked; please retry shortly.</p>}
    {!membership?.active && <p>The Theatre is locked. Signing in alone does not unlock the room; an active paid membership is required.</p>}
    <p className="theatre-price">{THEATRE_PLAN.label}</p>
    <p>Your monthly plan renews until cancelled. View benefits and joining options on the <Link className="member-text-link" href="/membership">Membership page</Link>.</p>
    <p className="theatre-warning">Test payments only — no real charges. Sample content, not Don&apos;s final library.</p>
    {!enabled ? <p>Integration setup is in progress. Subscriptions are not open yet.</p> : <>
      <p>{membership ? membership.active ? "Membership active" : "No active paid access" : "Verifying membership…"}</p>
      {membership?.paidThrough && <p>Paid access until {new Date(membership.paidThrough).toLocaleDateString()}.</p>}
      {membership?.cancelAtPeriodEnd && <p>Renewal is cancelled.</p>}
      <div className="theatre-buttons">
        {membership && !membership.hasSubscription && <Link className="member-button" href="/membership">Explore membership</Link>}
        {membership?.hasSubscription && !membership.cancelAtPeriodEnd && <button disabled={busy} onClick={() => action("cancel")}>Cancel renewal</button>}
        <button disabled={busy} onClick={() => action("refresh")}>Refresh membership</button>
      </div>
    </>}
    <p role="status" aria-live="polite">{message}</p>
    {enabled && membership?.active && <Link className="member-button" prefetch={false} href="/theatre">Enter Theatre</Link>}
    <p><Link className="member-text-link" href="/account">Back to your account</Link></p>
  </section>;
}
