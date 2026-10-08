import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import SetupNotice from "@/components/MemberAccount/SetupNotice";
import { hideLocalAuthFooter, isAuthConfigured } from "@/server/auth/config";
import { accountNavigation } from "@/lib/account-navigation";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const navigation = accountNavigation((await searchParams).next);
  if (!isAuthConfigured()) return <SetupNotice />;
  return (
    <section className="member-auth-section" aria-labelledby="sign-up-title">
      <p className="member-eyebrow">Your Continental account</p>
      <h1 id="sign-up-title">Your place at the Continental.</h1>
      <p className="member-introduction">Create your account and verify your email. A separate paid subscription will be required to watch exclusive videos.</p>
      <SignUp routing="path" path="/sign-up" signInUrl={navigation.signIn} forceRedirectUrl={navigation.destination} />
      {hideLocalAuthFooter() && <p className="member-auth-switch">Already have an account? <Link className="member-text-link" href={navigation.signIn}>Sign in</Link></p>}
    </section>
  );
}
