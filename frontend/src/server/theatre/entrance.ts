import "server-only";
import { getTheatreAccess } from "@/server/auth/member";

/** Run on the server before rendering the room OR querying its private library. */
export async function theatreEntrance(): Promise<{ destination: string | null; paidThrough: Date | null }> {
  try {
    const access = await getTheatreAccess();
    if (!access.allowed && access.reason === "unavailable") return { destination: "/membership?notice=unavailable", paidThrough: null };
    if (process.env.THEATRE_ENABLED !== "true") return { destination: "/membership?notice=setup", paidThrough: null };
    return access.allowed ? { destination: null, paidThrough: access.paidThrough } : { destination: "/membership", paidThrough: null };
  } catch {
    // Provider/DB failures never render the room or turn into a paid-access bypass.
    return { destination: "/membership?notice=unavailable", paidThrough: null };
  }
}

export async function theatreDestination(): Promise<string | null> {
  return (await theatreEntrance()).destination;
}
