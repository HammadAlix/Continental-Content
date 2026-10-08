import type { NormalizedRect } from "./coverFit";

// Client-provided catalogue. Test checkout only; stock is not tracked yet.
export const MERCH_SIZES = ["S", "M", "L", "XL", "6", "7", "8", "9", "10", "11", "12"] as const;
export type MerchSize = (typeof MERCH_SIZES)[number];
export type MerchGroup = "hoodies" | "tees" | "jackets" | "slides";
export type MerchProduct = {
  id: string;
  name: string;
  category: string;
  group: MerchGroup;
  price: number; // USD cents.
  description: string;
  sizes: readonly MerchSize[];
  imageUrl?: string;
};

export const MERCH_PRODUCTS: readonly MerchProduct[] = [
  {"id":"moonlight-hoodie","name":"Moonlight Hoodie","category":"Minimalist white hoodie","group":"hoodies","price":6000,"description":"Minimalist white hoodie.","sizes":["S","M","L","XL"]},
  {"id":"midnight-hoodie","name":"Midnight Hoodie","category":"Minimalist black hoodie","group":"hoodies","price":6000,"description":"Minimalist black hoodie.","sizes":["S","M","L","XL"]},
  {"id":"kuku-hoodie","name":"KuKu Hoodie","category":"Graphic white hoodie","group":"hoodies","price":7500,"description":"Graphic white hoodie.","sizes":["S","M","L","XL"]},
  {"id":"tri-hoodie","name":"Tri Hoodie","category":"Graphic black hoodie","group":"hoodies","price":7500,"description":"Graphic black hoodie.","sizes":["S","M","L","XL"]},
  {"id":"casual-cont-white","name":"Casual Cont White T","category":"Minimalist white T-shirt","group":"tees","price":3500,"description":"Minimalist white T-shirt.","sizes":["S","M","L","XL"]},
  {"id":"casual-cont-black","name":"Casual Cont Black","category":"Minimalist black T-shirt","group":"tees","price":3500,"description":"Minimalist black T-shirt.","sizes":["S","M","L","XL"]},
  {"id":"continental-slides","name":"Continental Slides","category":"Flip flops","group":"slides","price":6500,"description":"Continental flip flops in sizes 6–12. Footwear sizing system to be confirmed.","sizes":["6","7","8","9","10","11","12"]},
  {"id":"continental-apocalypse","name":"Continental Apocalypse","category":"Varsity jacket","group":"jackets","price":22500,"description":"Varsity jacket.","sizes":["S","L","XL"]},
  {"id":"continental-rebirth","name":"Continental Rebirth","category":"Varsity jacket","group":"jackets","price":20000,"description":"Varsity jacket.","sizes":["S","L","XL"]},
];

// Scene artwork is category navigation, not a photo of an actual product.
export const MERCH_DISPLAYS: Record<string, { label: string; group: MerchGroup }> = {
  varsity: { label: "Varsity jackets", group: "jackets" },
  hoodie: { label: "Hoodies", group: "hoodies" },
  "crest-tee": { label: "T-shirts", group: "tees" },
  jersey: { label: "T-shirts", group: "tees" },
  signature: { label: "Varsity jackets", group: "jackets" },
};
const ROOM_CROPS: readonly NormalizedRect[] = [
  { x: .290, y: .193, width: .108, height: .221 },
  { x: .603, y: .190, width: .099, height: .225 },
  { x: .198, y: .487, width: .057, height: .246 },
  { x: .752, y: .485, width: .052, height: .265 },
  { x: .503, y: .538, width: .139, height: .289 },
];

// Regions measured on the 2752 × 1536 source, including the angled side displays.
// Curved clipping masks use local 0–100 coordinates. They reveal the original
// pixels without redrawing logos or carrying rectangular pieces of the room.
export const MERCH_HOTSPOTS = [
  { id: "varsity-side", productId: "varsity", rect: { x: .201, y: .180, width: .057, height: .244 }, mask: "M5.7 2.4 Q10 2.4 13 4 L39 10 Q55 13.5 64 19 Q72 26 73.5 35 L77 57 L80 77 Q81 80 77 82 L76 88 Q63 90 48 88 L39 85 L36 88 L5.7 85 Z" },
  { id: "varsity-front", productId: "varsity", rect: ROOM_CROPS[0], mask: "M41.5 4.8 Q43 7 48 8 L55 8 Q59 6.5 60.5 4.8 L67 8 Q77 11 82 15 Q86 18 88 27 L94 53 L97.5 74 Q100 83 98 87 L97 95.8 Q94 97 88 97 L87 90 L82.5 88 L80.5 50 L79.5 85 L80.5 92 Q69 94.8 51 94.6 Q35 94.5 24.2 92 L24 88 L20.6 86 L21 47 L18.5 84 Q18 88 15.2 90 L14 96.7 Q9 96.2 4 94 L5.5 88 Q2.7 86.5 3.6 81 L7 56 L10 35 Q13 22 16 17 Q21 13 30 10 L38 7 Z" },
  { id: "hoodie-front", productId: "hoodie", rect: ROOM_CROPS[1], mask: "M34 6.7 L36.2 8.2 L40.7 6.8 Q43 11 46 12 L57 12 Q60 10 62 7.1 L65 7.7 L68 6.7 L73 10 Q76 11.7 76 13 L82 14.8 Q88 17 89.8 26 L95 46 Q98 68 99 88.8 L99 96.8 Q96 98 91 97.8 L90.3 89 L86.5 88 L82.5 52 L80 83 L80 92.8 Q59 91.5 43 92 Q32 92.5 24 92.8 L24 84 L23 50 L19 72 L16 88.6 L14.4 90 L13.7 97.3 Q9 98 4.4 97.3 L4.5 90 L3.8 89 L4 78 L7 54 L10 34 Q12.4 20 16.5 17 L25 13.5 L29 12 L28 11.5 L31 8.5 Z" },
  { id: "hoodie-side", productId: "hoodie", rect: { x: .754, y: .180, width: .051, height: .247 }, mask: "M82 3 L77 2 Q74 5 66 7.4 L56 10 Q47 11 39 13 L24 16 Q14 19 12 27 L7 51 L7 75 L10 86 L10 92 Q19 93 29 92 L30 89 L48 89 L82 87 Z" },
  { id: "tee-left", productId: "crest-tee", rect: ROOM_CROPS[2], mask: "M10.8 10.8 Q14 10 18 11.5 L38 16 Q50 18.5 54 21.2 Q58 25 62 32 L71.5 44.7 Q58 47.7 48 48 L45 47.5 L43 65 L36 92.5 L10.8 92 Z" },
  { id: "jersey-right", productId: "jersey", rect: ROOM_CROPS[3], mask: "M63 11.2 L68 13 L83.5 17.5 L85 87 L56 87 L53 62 L52 42 L47 43 Q33 42 17 38 L24 29 Q27 21 35 17.5 L48 14 Z" },
  { id: "signature-centre", productId: "signature", rect: ROOM_CROPS[4], mask: "M41.9 1 Q49 -0.3 55.8 0.8 Q57.8 1.3 57.8 3.5 L57.8 6.2 Q59 7.1 59.5 8.8 L60.3 11.7 Q66 13.4 71.8 15.5 Q77 17.2 79.5 20.5 Q82 24 84 30 L88.2 46 L92.8 66 L96.5 83.8 Q97.8 88.5 96 90.8 L94.7 92.7 L95.8 97.8 Q91 99.2 86.3 98.9 L85.4 93 Q82.3 92 79.6 86.5 L77 81.5 L75 77.5 L77 86 Q78 89 75.5 91 L75 97 Q64 99.8 49 99.6 Q34 99.7 24.8 97.5 L24.8 92 Q21.7 90 21 84 L20.2 76.7 L17.8 82.3 L17.5 87 Q17 90.4 15.2 92 L14.4 96.5 Q10 98.1 4.4 96.5 L4 92 Q1.9 91 2 88 L4 73 L6 58 L9 41 L11.8 28.2 Q14.2 22 17.4 19.1 Q21 16.9 26 15.3 L35.9 12 Q38.3 11.1 38.8 9.6 L39.7 7 Q40.5 6 41.8 5.8 Z" },
] as const;

export type MerchHotspot = (typeof MERCH_HOTSPOTS)[number];

export type CartLine = { productId: string; size: MerchSize; quantity: number };
export const MERCH_CART_KEY = "continental-merch-preview-v1";
export const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(cents / 100);

export function readMerchCart(products: readonly MerchProduct[] = MERCH_PRODUCTS): CartLine[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MERCH_CART_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((line): line is CartLine => !!line &&
      products.some((product) => product.id === line.productId && product.sizes.includes(line.size)) && Number.isInteger(line.quantity) &&
      line.quantity > 0 && line.quantity <= 10).slice(0, 25);
  } catch { return []; }
}
