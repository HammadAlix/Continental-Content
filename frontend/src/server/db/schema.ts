import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Database schema. One table per domain concept; this file is the single
 * source of truth for the shape, and migrations are generated from it.
 */

export const serviceRequests = pgTable(
  "service_requests",
  {
    id: serial("id").primaryKey(),

    /**
     * The code quoted back to the visitor. Unique so a retried submission
     * can't quietly create a second row under the same reference.
     */
    reference: varchar("reference", { length: 16 }).notNull().unique(),
    submissionKey: varchar("submission_key", { length: 64 }).unique(),
    payloadHash: varchar("payload_hash", { length: 64 }),

    name: varchar("name", { length: 80 }).notNull(),
    email: varchar("email", { length: 160 }).notNull(),
    /** Matches an id in lib/services.ts. */
    service: varchar("service", { length: 40 }).notNull(),
    details: text("details").notNull(),

    /**
     * Hashed, never raw. An IP address is personal data, and the only thing
     * it's needed for — spotting one source flooding the form — works just as
     * well on a hash.
     */
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: text("user_agent"),

    /** Set when the notification email actually went out; null if it never did. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Reading is always "newest first", and the admin view will page over it.
    index("service_requests_created_at_idx").on(table.createdAt),
    // Finding every request from one person, when they email asking about one.
    index("service_requests_email_idx").on(table.email),
  ]
);

export type ServiceRequestRow = typeof serviceRequests.$inferSelect;
export type NewServiceRequest = typeof serviceRequests.$inferInsert;

export type OfficeEmailPayload = { from: string; to: string; subject: string; text: string; replyTo: string };
export const officeEmailJobs = pgTable("office_email_jobs", {
  id: varchar("id", { length: 40 }).primaryKey(),
  reference: varchar("reference", { length: 16 }).notNull().references(() => serviceRequests.reference),
  kind: varchar("kind", { length: 12 }).notNull(),
  payload: jsonb("payload").$type<OfficeEmailPayload>().notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lockToken: varchar("lock_token", { length: 36 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: varchar("last_error", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("office_email_jobs_due_idx").on(table.status, table.nextAttemptAt)]);

export type OrderItem = { productId: string; name: string; size: string; quantity: number; unitAmount: number };

export const merchOrders = pgTable("merch_orders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  attemptId: varchar("attempt_id", { length: 36 }).notNull().unique(),
  cartHash: varchar("cart_hash", { length: 64 }).notNull(),
  items: jsonb("items").$type<OrderItem[]>().notNull(),
  subtotal: integer("subtotal").notNull(),
  shipping: integer("shipping").notNull(),
  total: integer("total").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  stripeSessionId: text("stripe_session_id").unique(),
  email: text("email"),
  delivery: jsonb("delivery").$type<{ name: string | null; address: Record<string, string | null> | null }>(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  customerNotifiedAt: timestamp("customer_notified_at", { withTimezone: true }),
  deskNotifiedAt: timestamp("desk_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Shared across serverless instances. Fixed one-hour windows; no raw IPs stored.
export const checkoutLimits = pgTable("checkout_limits", {
  key: varchar("key", { length: 96 }).primaryKey(),
  count: integer("count").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
