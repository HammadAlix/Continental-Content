import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Link from "next/link";
import { hideLocalAuthFooter, isAuthConfigured } from "@/server/auth/config";
import "./membership.css";

export const metadata: Metadata = {
  title: "Member access — Continental Content",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  const shell = (
    <main className="member-page">
      <header className="member-header">
        <Link href="/?foyer=1" className="member-brand">Continental <span>Content</span></Link>
        <Link href="/?foyer=1">Back to the foyer</Link>
      </header>
      <div className="member-content">{children}</div>
      <footer className="member-footer">Your Continental account. Theatre access requires an active subscription. <Link href="/merch">Shop merch without an account.</Link></footer>
    </main>
  );

  if (!isAuthConfigured()) return shell;
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInForceRedirectUrl="/account"
      signUpForceRedirectUrl="/account"
      localization={{
        signIn: { start: { title: "Sign in to the Continental", titleCombined: "Sign in to the Continental" } },
        signUp: { start: { title: "Create your account" } },
      }}
      appearance={{
        options: { unsafe_disableDevelopmentModeWarnings: hideLocalAuthFooter() },
        variables: {
          colorPrimary: "#d4af37",
          colorBackground: "#171410",
          colorInput: "#0e0c09",
          colorInputForeground: "#f4ecd8",
          colorForeground: "#f4ecd8",
          colorNeutral: "#f4ecd8",
          colorMutedForeground: "#bdb39f",
          colorDanger: "#ffaaa0",
          borderRadius: "0.4rem",
          fontFamily: "var(--font-geist-sans), Arial, sans-serif",
        },
        elements: {
          footer: hideLocalAuthFooter() ? { display: "none" } : undefined,
          rootBox: "member-auth-root",
          cardBox: "member-auth-card",
          formButtonPrimary: { color: "#171410" },
          socialButtonsBlockButton: { color: "#f4ecd8", border: "1px solid #66552c", background: "#211c14" },
          socialButtonsBlockButtonText: { color: "#f4ecd8" },
        },
      }}
    >{shell}</ClerkProvider>
  );
}
