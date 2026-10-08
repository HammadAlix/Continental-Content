import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { validateProduct } from "@/lib/admin-product";

/** Product and audit row commit together. Version matching prevents lost updates. */
export async function saveProduct(value: ReturnType<typeof validateProduct>, photo: string | null | undefined, actorId: string) {
  const { product, published, revision } = value;
  const data = JSON.stringify(product);
  const snapshot = JSON.stringify({ product, published, photoChanged: photo !== undefined });
  const mutation = revision === 0
    ? sql`insert into merch_products (id, data, published, revision, image_base64)
        values (${product.id}, ${data}::jsonb, ${published}, 1, ${photo ?? null})
        on conflict (id) do nothing returning id, revision`
    : sql`update merch_products set data = ${data}::jsonb, published = ${published},
        revision = revision + 1, updated_at = now(),
        image_base64 = case when ${photo !== undefined} then ${photo ?? null} else image_base64 end
        where id = ${product.id} and revision = ${revision} returning id, revision`;
  const result = await db().execute(sql`with changed as (${mutation}),
    audited as (
      insert into merch_product_audit (product_id, actor_id, revision, snapshot)
      select id, ${actorId}, revision, ${snapshot}::jsonb from changed returning id
    ) select changed.id, changed.revision from changed, audited`);
  return result.rows.length > 0;
}
