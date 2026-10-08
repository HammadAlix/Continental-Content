import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import SetupNotice from "@/components/MemberAccount/SetupNotice";
import { isAuthConfigured } from "@/server/auth/config";
import { getMember } from "@/server/auth/member";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isAuthConfigured()) return <SetupNotice />;
  if (!await getMember()) redirect("/sign-in");
  return (
    <section className="member-settings" aria-labelledby="settings-title">
      <h1 id="settings-title">Account settings</h1>
      <p className="member-introduction"><Link className="member-text-link" href="/account">Back to your account</Link></p>
      <UserProfile routing="path" path="/account/settings" />
    </section>
  );
}
