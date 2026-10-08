"use client";

import { SignOutButton } from "@clerk/nextjs";
import { clearAdminShortcut } from "@/lib/admin-shortcut";

export default function MemberControls() {
  return (
    <SignOutButton redirectUrl="/?foyer=1">
      <button className="member-button member-button-secondary" type="button" onClick={() => {
        clearAdminShortcut();
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("continental-sign-out");
          channel.postMessage("signed-out");
          channel.close();
        }
      }}>Sign out</button>
    </SignOutButton>
  );
}
