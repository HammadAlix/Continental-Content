import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import SetupNotice from "@/components/MemberAccount/SetupNotice";
import { hideLocalAuthFooter, isAuthConfigured } from "@/server/auth/config";
import { accountNavigation } from "@/lib/account-navigation";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const navigation = accountNavigation((await searchParams).next);
  if (!isAuthConfigured()) return <SetupNotice />;
  return (
    <section className="member-auth-section" aria-labelledby="sign-in-title">
      <p className="member-eyebrow">Your Continental account</p>
      <h1 id="sign-in-title">Welcome back.</h1>
      <p className="member-introduction">{navigation.destination === "/theatre" ? "Sign in to continue. The Theatre unlocks only with an active paid membership." : "Sign in to manage your account and memberships."}</p>
      <SignIn routing="path" path="/sign-in" signUpUrl={navigation.signUp} forceRedirectUrl={navigation.destination} />
      {hideLocalAuthFooter() && <p className="member-auth-switch">Don’t have an account? <Link className="member-text-link" href={navigation.signUp}>Sign up</Link></p>}
    </section>
  );
}
