import Link from "next/link";

export default function SetupNotice() {
  return (
    <section className="member-panel" aria-labelledby="account-unavailable">
      <p className="member-eyebrow">Your Continental account</p>
      <h1 id="account-unavailable">Accounts open soon.</h1>
      <p>We are preparing member registration. Sign-up and sign-in are not available yet.</p>
      <p className="member-muted">The Office and guest merch checkout are still available.</p>
      <Link className="member-button" href="/?foyer=1">Back to the foyer</Link>
    </section>
  );
}
