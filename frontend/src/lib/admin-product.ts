import { MERCH_SIZES, type MerchProduct, type MerchGroup } from "./merch";

export type AdminProduct = MerchProduct & { published: boolean; revision: number };
export function validateProduct(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid product.");
  const value = input as Record<string, unknown>;
  const text = (key: string, max: number, required = true) => {
    const item = value[key];
    if (typeof item !== "string" || item.trim().length > max || (required && !item.trim())) throw new Error(`Check ${key} (maximum ${max} characters).`);
    return item.trim();
  };
  const id = text("id", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Product ID must use lowercase letters, numbers and single hyphens.");
  if (typeof value.group !== "string" || !["hoodies", "tees", "jackets", "slides"].includes(value.group)) throw new Error("Choose a valid collection.");
  if (!Number.isSafeInteger(value.price) || Number(value.price) < 50 || Number(value.price) > 1000000) throw new Error("Price must be between $0.50 and $10,000.");
  if (!Array.isArray(value.sizes) || !value.sizes.length || value.sizes.length > MERCH_SIZES.length ||
      value.sizes.some(s => !MERCH_SIZES.includes(s)) || new Set(value.sizes).size !== value.sizes.length) throw new Error("Choose valid, non-duplicate sizes.");
  if (typeof value.published !== "boolean" || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error("Invalid product version or visibility.");
  if (value.imageData !== undefined && value.imageData !== null && typeof value.imageData !== "string") throw new Error("Invalid photo.");
  return {
    product: { id, name: text("name", 100), category: text("category", 100),
      group: value.group as MerchGroup, price: Number(value.price),
      description: text("description", 2000, false), sizes: value.sizes } satisfies MerchProduct,
    published: value.published, revision: Number(value.revision),
    imageData: value.imageData as string | null | undefined,
  };
}
