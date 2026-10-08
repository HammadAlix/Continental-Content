import type { Metadata } from "next";
import Link from "next/link";
import { THEATRE_PLAN } from "@/lib/theatre";
import { getMember } from "@/server/auth/member";
import { getMembershipSnapshot } from "@/server/theatre/membership";
import MembershipJoin, { type MembershipViewer } from "@/components/TheatreMembership/MembershipJoin";
import "./pricing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Theatre Membership — Continental Content",
  description: "One monthly membership for all current and future Continental Theatre videos.",
};

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  let viewer: MembershipViewer = "unavailable";
  const enabled = process.env.THEATRE_ENABLED === "true";
  let initialMembership = null;
  let viewerKey = "guest";
  try {
    const member = await getMember();
    viewer = !member ? "guest" : member.emailVerified ? "verified" : "unverified";
    viewerKey = member?.id ?? "guest";
    if (enabled && member?.emailVerified) {
      const summary = await getMembershipSnapshot(member.id);
      initialMembership = { active: summary.active, hasSubscription: summary.hasSubscription };
    }
  } catch { viewer = "unavailable"; /* Keep the offer readable; no unverified checkout. */ }
  const { notice } = await searchParams;
  // eslint-disable-next-line react-hooks/purity -- Per-request timestamp in a force-dynamic SERVER page, serialized to the client.
  const initialCheckedAt = Date.now();
  return <section className="membership-offer" aria-labelledby="membership-title">
    <div className="membership-offer-intro">
      <p className="member-eyebrow">Continental Content · Membership</p>
      <h1 id="membership-title">Your seat at<br />the Continental.</h1>
      <p className="membership-offer-lead">Step beyond the foyer. One membership opens the Theatre and its exclusive video collection.</p>
      <p className="membership-offer-note">Browse the offer here. Watch inside the Theatre. Manage your membership in My Account.</p>
      <Link className="member-text-link" href="/merch">Just visiting the wardrobe? Shop without a membership.</Link>
    </div>
    <div className="membership-plan">
      <p className="member-eyebrow">Theatre membership</p>
      <h2>All access. One monthly plan.</h2>
      <p className="membership-plan-price">{THEATRE_PLAN.label}</p>
      <ul>
        <li>{THEATRE_PLAN.includes}</li>
        <li>Watch directly inside the Continental Theatre</li>
        <li>Cancel renewal from My Account; keep access through your paid period</li>
      </ul>
      <p className="membership-plan-terms">Billed in USD. Renews monthly until cancelled. Merchandise is sold separately.</p>
      {notice === "unavailable" && <p role="alert">Access could not be verified. The Theatre remains locked; please try again shortly.</p>}
      <MembershipJoin key={viewerKey} enabled={enabled} viewer={viewer} initialMembership={initialMembership} initialCheckedAt={initialCheckedAt} />
      <div className="membership-setup-note">
        <p>Test payments only — no real charges. The current video is a demonstration, not Don&apos;s final collection.</p>
      </div>
    </div>
  </section>;
}
