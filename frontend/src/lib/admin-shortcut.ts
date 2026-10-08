"use client";

export const ADMIN_SIGNOUT_EVENT = "continental-admin-signout";
export function clearAdminShortcut() {
  window.dispatchEvent(new Event(ADMIN_SIGNOUT_EVENT));
}

// Per-render presentation state, seeded by the server's owner check. Never a
// module-global permission cache shared between visitors or a browser-storage role.
export function createAdminShortcut(initialAllowed: boolean) {
type Visibility = "allowed" | "denied";
const initial: Visibility = initialAllowed ? "allowed" : "denied";
let visibility: Visibility = initial;
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let controller: AbortController | undefined;
let generation = 0;
let lastStarted = 0;

function publish(next: Visibility) {
  if (visibility === next) return;
  visibility = next;
  listeners.forEach(listener => listener());
}

function subscribeAdminShortcut(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const adminShortcutSnapshot = () => visibility;
const adminShortcutServerSnapshot = () => initial;

function clearAdminShortcut() {
  generation++;
  controller?.abort();
  pending = undefined;
  lastStarted = 0;
  publish("denied");
}

function refreshAdminShortcut(): Promise<void> {
  // A tab switch can emit focus, pageshow and visibilitychange together.
  // Share one request instead of aborting/restarting it for each event.
  if (pending) return pending;
  if (Date.now() - lastStarted < 750) return Promise.resolve();
  lastStarted = Date.now();
  const requestGeneration = generation;
  const active = new AbortController();
  controller = active;
  const timeout = setTimeout(() => active.abort(), 15000);
  pending = (async () => {
    try {
      const response = await fetch("/api/admin/access", { cache: "no-store", credentials: "same-origin", signal: active.signal });
      if (requestGeneration !== generation || active.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { publish("denied"); return; }
      if (!response.ok) return; // Network/provider trouble is not an access revocation.
      const data = await response.json();
      if (requestGeneration !== generation || active.signal.aborted) return;
      if (typeof data.allowed === "boolean") publish(data.allowed ? "allowed" : "denied");
    } catch {
      // Preserve a confirmed shortcut on transient failure. Unknown users never
      // become allowed; following a stale shortcut cannot bypass server checks.
    } finally {
      clearTimeout(timeout);
      if (requestGeneration === generation) { pending = undefined; controller = undefined; }
    }
  })();
  return pending;
}
return { subscribeAdminShortcut, adminShortcutSnapshot, adminShortcutServerSnapshot, clearAdminShortcut, refreshAdminShortcut };
}
