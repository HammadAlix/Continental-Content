/** Fixed destinations only: never redirect to an arbitrary user-supplied URL. */
export function accountNavigation(next: string | string[] | undefined) {
  const theatre = next === "theatre";
  const membership = next === "membership";
  const billing = next === "billing";
  return {
    destination: theatre ? "/theatre" : membership ? "/membership" : billing ? "/account/theatre" : "/account",
    signIn: theatre ? "/sign-in?next=theatre" : membership ? "/sign-in?next=membership" : billing ? "/sign-in?next=billing" : "/sign-in",
    signUp: theatre ? "/sign-up?next=theatre" : membership ? "/sign-up?next=membership" : billing ? "/sign-up?next=billing" : "/sign-up",
  };
}
