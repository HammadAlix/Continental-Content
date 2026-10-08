import { redirect } from "next/navigation";
import Link from "next/link";
import { getMember } from "@/server/auth/member";
import TheatreMembership from "@/components/TheatreMembership/TheatreMembership";
export const dynamic = "force-dynamic";
export default async function MemberTheatrePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const member = await getMember();
  if (!member) redirect("/sign-in?next=billing");
  if (!member.emailVerified) return <section className="member-panel"><h1>Verify your email first</h1><Link href="/account/settings">Account settings</Link></section>;
  const enabled = process.env.THEATRE_ENABLED === "true";
  const { notice } = await searchParams;
  return <TheatreMembership enabled={enabled} unavailable={notice === "unavailable"} />;
}
