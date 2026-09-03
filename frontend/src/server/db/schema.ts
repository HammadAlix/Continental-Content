import {
  index,
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
