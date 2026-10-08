"use client";

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <section className="member-panel" role="alert">
      <h1>Account service unavailable.</h1>
      <p>We could not securely load your account. Please try again shortly.</p>
      <button className="member-button" onClick={reset}>Try again</button>
    </section>
  );
}
