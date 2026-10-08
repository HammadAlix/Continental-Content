/** One server-authoritative plan. Never accept a price from the browser. */
export const THEATRE_PLAN = {
  id: "continental-theatre-monthly-v1",
  name: "Continental Theatre Membership",
  amount: 599,
  currency: "usd",
  interval: "month",
  label: "$5.99 USD / month",
  includes: "All current and future Theatre videos",
} as const;

export type TheatreEntitlement = {
  status: string;
  paidThrough: Date | null;
  revokedAt: Date | null;
  livemode: boolean;
};

/** No trials, unpaid grace period or client-controlled membership flags. */
export function hasTheatreEntitlement(value: TheatreEntitlement | null, now = new Date()) {
  return Boolean(value && !value.livemode && !value.revokedAt &&
    value.status === "active" && value.paidThrough && value.paidThrough > now);
}
