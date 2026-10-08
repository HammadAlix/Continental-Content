import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdmin } from "@/server/auth/admin";
import StoreAdmin from "@/components/StoreAdmin/StoreAdmin";
import type { Metadata } from "next";
import "./admin-store.css";

export const metadata: Metadata = {
  title: "Manage Store — Continental Content",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  if (!await getAdmin()) redirect("/account");
  return <main className="owner-console">
    <header className="owner-console-header">
      <Link href="/?foyer=1" className="owner-console-brand">Continental <span>Content</span></Link>
      <nav aria-label="Store management navigation">
        <Link href="/?foyer=1">Back to the foyer</Link>
        <Link href="/merch">View Store</Link>
        <Link href="/account">My Account</Link>
      </nav>
    </header>
    <section className="owner-console-panel" aria-labelledby="owner-console-title">
    <p className="owner-console-eyebrow">Private owner workspace</p>
    <h1 id="owner-console-title">Manage Store</h1>
    <p>Edit the collection, upload photos and publish when ready. Payments remain in test mode; stock is not tracked.</p>
    <StoreAdmin />
    </section>
  </main>;
}
