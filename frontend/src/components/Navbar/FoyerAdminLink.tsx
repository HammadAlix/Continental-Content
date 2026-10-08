"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createAdminShortcut, ADMIN_SIGNOUT_EVENT } from "@/lib/admin-shortcut";

/** The initial HTML and hydration both use the same per-request server result. */
export default function FoyerAdminLink({ initialAllowed, onNavigate }: { initialAllowed: boolean; onNavigate: () => void }) {
  const [state] = useState(() => createAdminShortcut(initialAllowed));
  const visibility = useSyncExternalStore(state.subscribeAdminShortcut, state.adminShortcutSnapshot, state.adminShortcutServerSnapshot);
  useEffect(() => {
    const refresh = () => { void state.refreshAdminShortcut(); };
    function onVisible() { if (document.visibilityState === "visible") refresh(); }
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("continental-sign-out") : null;
    if (channel) channel.onmessage = () => state.clearAdminShortcut();
    window.addEventListener(ADMIN_SIGNOUT_EVENT, state.clearAdminShortcut);
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      channel?.close();
      window.removeEventListener(ADMIN_SIGNOUT_EVENT, state.clearAdminShortcut);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state]);
  if (visibility !== "allowed") return null;
  return <li className="navbar-owner-entry"><Link href="/admin/store" prefetch={false} onClick={onNavigate}>Manage Store</Link></li>;
}
