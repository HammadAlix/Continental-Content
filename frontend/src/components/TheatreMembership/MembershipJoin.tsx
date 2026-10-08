  "use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type MembershipViewer = "guest" | "unverified" | "verified" | "unavailable";
type Status = { active: boolean; hasSubscription: boolean };

export default function MembershipJoin({ enabled, viewer, initialMembership = null, initialCheckedAt = 0 }: {
  enabled: boolean; viewer: MembershipViewer; initialMembership?: Status | null; initialCheckedAt?: number;
}) {
  const [membership, setMembership] = useState<Status | null>(initialMembership);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    if (!enabled || viewer !== "verified") return;
    let controller: AbortController | undefined;
    let lastCheck = initialMembership ? initialCheckedAt : 0;
    async function refresh() {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck < 60000) return;
      controller?.abort();
      const request = new AbortController(); controller = request;
      lastCheck = Date.now();
      try {
        const response = await fetch("/api/theatre/membership?view=access", { cache: "no-store", signal: request.signal });
        const body = await response.json();
        if (!response.ok || typeof body.active !== "boolean" || typeof body.hasSubscription !== "boolean") throw new Error("Membership could not be verified.");
        if (!request.signal.aborted) { setMembership(body); setMessage(""); }
      } catch { if (!request.signal.aborted) { setMembership(null); setMessage("Membership could not be verified. Refresh this page before trying again."); } }
    }
    const onVisible = () => { void refresh(); };
    void refresh();
    const timer = setInterval(onVisible, 60000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller?.abort(); clearInterval(timer); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, viewer, initialMembership, initialCheckedAt]);

  async function join() {
    if (submitting.current || !enabled || viewer !== "verified" || !membership || membership.active || membership.hasSubscription) return;
    submitting.current = true;
    setBusy(true); setMessage("");
    try {
      // Never create a checkout from a GET, page visit, query flag or prefetch.
      const response = await fetch("/api/theatre/checkout", { method: "POST", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || typeof body.url !== "string") throw new Error("Checkout unavailable");
      const url = new URL(body.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) throw new Error("Invalid checkout destination");
      window.location.assign(url.href);
    } catch {
      setMessage("Checkout could not be confirmed. Check My Account or refresh before trying again.");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <div className="membership-join">
    {!enabled ? <><button className="member-button" disabled>Membership opens soon</button><p>Playback setup is being completed. Subscriptions are not open yet.</p></> :
      viewer === "guest" ? <Link className="member-button" href="/sign-up?next=membership">Join the Theatre</Link> :
      viewer === "unverified" ? <><p>Verify your primary email before subscribing.</p><Link className="member-button" href="/account/settings">Verify email in account settings</Link></> :
      viewer === "unavailable" ? <p role="alert">Account verification is unavailable. Please refresh shortly.</p> :
      !membership ? <button className="member-button" disabled>Checking your membership…</button> :
      membership.active ? <Link className="member-button" prefetch={false} href="/theatre">Enter Theatre</Link> :
      membership.hasSubscription ? <Link className="member-button" href="/account/theatre">Manage existing membership</Link> :
      <button className="member-button" disabled={busy} onClick={join}>{busy ? "Opening secure checkout…" : "Continue to test checkout"}</button>}
    <p role="status" aria-live="polite">{message}</p>
    {viewer === "guest" ? <p>Already have an account? <Link className="member-text-link" href="/sign-in?next=membership">Sign in</Link></p> :
      <p><Link className="member-text-link" href="/account/theatre">Manage membership in My Account</Link></p>}
  </div>;
}
