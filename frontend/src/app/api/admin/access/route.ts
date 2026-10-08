import { getAdmin } from "@/server/auth/admin";

export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    return Response.json({ allowed: Boolean(await getAdmin()) }, { headers });
  } catch {
    return Response.json({ allowed: false }, { status: 503, headers });
  }
}
