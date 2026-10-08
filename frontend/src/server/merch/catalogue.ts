import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { merchProducts } from "@/server/db/schema";
import type { AdminProduct } from "@/lib/admin-product";
import type { MerchProduct } from "@/lib/merch";

export async function getCatalogue(admin = false): Promise<AdminProduct[]> {
  const rows = await db().select({ data: merchProducts.data, published: merchProducts.published,
    revision: merchProducts.revision, hasImage: sql<boolean>`${merchProducts.imageBase64} is not null` })
    .from(merchProducts).where(admin ? undefined : eq(merchProducts.published, true))
    .orderBy(asc(merchProducts.id));
  return rows.map(row => ({ ...row.data, published: row.published, revision: row.revision,
    imageUrl: row.hasImage ? `/api/merch/images/${row.data.id}?v=${row.revision}` : undefined }));
}

export async function getPublicCatalogue(): Promise<MerchProduct[]> {
  return (await getCatalogue()).map(({ published: _published, revision: _revision, ...product }) => {
    void _published; void _revision;
    return product;
  });
}
