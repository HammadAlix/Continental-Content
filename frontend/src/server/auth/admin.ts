import "server-only";
import { getMember } from "./member";

/** Trust only the authenticated provider identity and its verified primary email. */
export async function getAdmin() {
  const owner = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!owner) return null;
  const member = await getMember();
  if (!member?.emailVerified || !member.email || member.email.trim().toLowerCase() !== owner) return null;
  return member;
}

/** Navigation may fail closed without making the public foyer unavailable. */
export async function getFoyerAdminAllowed() {
  try { return Boolean(await getAdmin()); }
  catch { return false; }
}
