/**
 * The services the Continental offers.
 *
 * Shared by the form and the route handler so the options a visitor can pick
 * and the values the server will accept can never drift apart. Same idea as the
 * room registry: one list, several consumers.
 */

export interface Service {
  id: string;
  label: string;
  /** Shown under the label while the option is selected. */
  note: string;
}

export const SERVICES: readonly Service[] = [
  {
    id: "collaboration",
    label: "Collaboration",
    note: "Creators and channels looking to work together.",
  },
  {
    id: "sponsorship",
    label: "Sponsorship",
    note: "Brands and partners with something to place.",
  },
  {
    id: "commission",
    label: "Commission",
    note: "Editing, production, or content made to brief.",
  },
  {
    id: "press",
    label: "Press",
    note: "Interviews, features, and enquiries from media.",
  },
  {
    id: "other",
    label: "Other business",
    note: "Anything that doesn't fit the categories above.",
  },
];

export const isServiceId = (value: string) =>
  SERVICES.some((service) => service.id === value);
