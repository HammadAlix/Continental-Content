import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAuthConfigured } from "./config";
import { getMembershipSnapshot } from "@/server/theatre/membership";

export async function getMember() {
  if (!isAuthConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user || user.id !== userId) return null;
  const email = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);
  return {
    id: user.id,
    name: user.firstName || "Member",
    email: email?.emailAddress ?? null,
    emailVerified: email?.verification?.status === "verified",
  };
}

/** Authentication is NOT a subscription. Never trust client membership flags. */
export async function getTheatreAccess() {
  if (!isAuthConfigured()) return { allowed: false, reason: "unavailable" } as const;
  const member = await getMember();
  if (!member) return { allowed: false, reason: "sign-in-required" } as const;
  if (!member.emailVerified) return { allowed: false, reason: "verification-required" } as const;
  const membership = await getMembershipSnapshot(member.id);
  if (membership.active && membership.paidThrough) return { allowed: true, reason: "paid-membership", paidThrough: membership.paidThrough } as const;
  return { allowed: false, reason: "subscription-required" } as const;
}
