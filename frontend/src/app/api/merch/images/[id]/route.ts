import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { merchProducts } from "@/server/db/schema";
import { getAdmin } from "@/server/auth/admin";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
  try {
    const { id } = await params;
    if (!/^[a-z0-9-]{1,80}$/.test(id)) return new Response(null, { status: 404, headers });
    const [row] = await db().select({ image: merchProducts.imageBase64, published: merchProducts.published })
      .from(merchProducts).where(eq(merchProducts.id, id));
    if (!row?.image || (!row.published && !await getAdmin())) return new Response(null, { status: 404, headers });
    return new Response(Buffer.from(row.image, "base64"), { headers: { ...headers, "Content-Type": "image/webp" } });
  } catch { return new Response(null, { status: 503, headers }); }
}
