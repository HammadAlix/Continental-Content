import { desc } from "drizzle-orm";
import { adminBody, adminJson, adminRequest } from "@/server/admin/http";
import { validateProduct } from "@/lib/admin-product";
import { preparePhoto } from "@/server/admin/photo";
import { saveProduct } from "@/server/admin/products";
import { getCatalogue } from "@/server/merch/catalogue";
import { db } from "@/server/db/client";
import { merchProductAudit } from "@/server/db/schema";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const access = await adminRequest(request);
    if (access.response) return access.response;
    const [products, history] = await Promise.all([getCatalogue(true),
      db().select({ id: merchProductAudit.id, productId: merchProductAudit.productId,
        revision: merchProductAudit.revision, createdAt: merchProductAudit.createdAt })
        .from(merchProductAudit).orderBy(desc(merchProductAudit.id)).limit(20)]);
    return adminJson({ products, history });
  } catch { return adminJson({ error: "Store management is temporarily unavailable." }, 503); }
}
export async function POST(request: Request) {
  try {
    const access = await adminRequest(request);
    if (access.response) return access.response;
    let value, photo;
    try {
      value = validateProduct(await adminBody(request));
      photo = await preparePhoto(value.imageData);
    } catch (error) {
      return adminJson({ error: error instanceof SyntaxError ? "Invalid JSON." : error instanceof Error ? error.message : "Invalid product." }, 400);
    }
    if (!await saveProduct(value, photo, access.admin.id)) return adminJson({ error: "This product changed in another tab, or its ID already exists. Refresh the list and reopen it before saving." }, 409);
    return adminJson({ saved: true });
  } catch { return adminJson({ error: "Save could not be confirmed. Refresh the list before retrying." }, 503); }
}
