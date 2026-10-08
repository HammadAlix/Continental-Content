import Link from "next/link";
import { redirect } from "next/navigation";
import MemberControls from "@/components/MemberAccount/MemberControls";
import SetupNotice from "@/components/MemberAccount/SetupNotice";
import { isAuthConfigured } from "@/server/auth/config";
import { getMember } from "@/server/auth/member";
import { getAdmin } from "@/server/auth/admin";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!isAuthConfigured()) return <SetupNotice />;
  const member = await getMember();
  if (!member) redirect("/sign-in");
  const admin = await getAdmin();
  return (
    <section className="member-panel" aria-labelledby="account-title">
      <p className="member-eyebrow">Your account</p>
      <h1 id="account-title">Welcome, {member.name}.</h1>
      <p className="member-email">{member.email}</p>
      <p className="member-status">{member.emailVerified ? "Email verified" : "Email verification required"}</p>
      {!member.emailVerified && <p>Verify your primary email in account settings before subscribing.</p>}
      <div className="member-subscription">
        <h2>Theatre membership</h2>
        <p className="member-status">Check paid access, billing and renewal here. Watch videos inside the Theatre.</p>
        <div className="member-actions"><Link className="member-button" href="/account/theatre">Manage membership</Link>
          <Link className="member-button member-button-secondary" href="/membership">View membership plan</Link></div>
      </div>
      <div className="member-actions">
        {admin && <Link className="member-button" href="/admin/store">Manage Store</Link>}
        <Link className="member-button" href="/account/settings">Account settings</Link>
        <MemberControls />
      </div>
      <Link className="member-text-link" href="/?foyer=1">Back to the foyer</Link>
    </section>
  );
}
