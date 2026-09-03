import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { serviceRequests, type ServiceRequestRow } from "@/server/db/schema";

/**
 * Every database access for service requests, and the only place SQL for them
 * is written. The service layer above calls these; it never builds a query
 * itself, so a schema change has one place to land.
 */

export interface SaveServiceRequest {
  reference: string;
  name: string;
  email: string;
  service: string;
  details: string;
  ipHash?: string;
  userAgent?: string;
}

export async function save(input: SaveServiceRequest): Promise<void> {
  await db().insert(serviceRequests).values(input);
}

/** Stamped once the notification actually went out — null means it never did. */
export async function markNotified(reference: string): Promise<void> {
  await db()
    .update(serviceRequests)
    .set({ notifiedAt: new Date() })
    .where(eq(serviceRequests.reference, reference));
}

/** Newest first. For the admin view, whenever the inbox stops being enough. */
export async function recent(limit = 50): Promise<ServiceRequestRow[]> {
  return db()
    .select()
    .from(serviceRequests)
    .orderBy(desc(serviceRequests.createdAt))
    .limit(limit);
}
