import { MERCH_PRODUCTS, type MerchProduct } from "./merch";

// Test checkout only. Confirm prices, fulfilment, shipping and taxes before going live.
export const TEST_SHIPPING_CENTS = 1000;
export const checkoutMoney = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);

export function validateCheckout(input: unknown, products: readonly MerchProduct[] = MERCH_PRODUCTS) {
  if (!input || typeof input !== "object") throw new Error("Invalid checkout request.");
  const { cart, attemptId } = input as Record<string, unknown>;
  if (typeof attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) throw new Error("Please refresh checkout and try again.");
  if (!Array.isArray(cart) || !cart.length || cart.length > 25) throw new Error("Your bag must contain between 1 and 25 lines.");
  const seen = new Set<string>();
  const items = cart.map((line: unknown) => {
    if (!line || typeof line !== "object") throw new Error("Invalid bag item.");
    const { productId, size, quantity } = line as Record<string, unknown>;
    const product = products.find((p) => p.id === productId);
    if (!product || typeof size !== "string" || !product.sizes.some((s) => s === size) || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error("Please check the products, sizes and quantities in your bag.");
    const key = `${product.id}:${size}`;
    if (seen.has(key)) throw new Error("Duplicate bag items. Please update your bag.");
    seen.add(key);
    return { productId: product.id, name: product.name, size, quantity, unitAmount: product.price };
  }).sort((a, b) => `${a.productId}:${a.size}`.localeCompare(`${b.productId}:${b.size}`));
  if (items.reduce((sum, item) => sum + item.quantity, 0) > 30) throw new Error("Please limit your order to 30 items.");
  const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
  return { attemptId, items, subtotal, shipping: TEST_SHIPPING_CENTS, total: subtotal + TEST_SHIPPING_CENTS };
}
