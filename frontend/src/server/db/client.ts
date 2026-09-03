import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The database handle.
 *
 * Built lazily rather than at module load: importing this file must not crash a
 * build or a page that never touches the database. Anything that needs the
 * connection asks for it, and only then does a missing DATABASE_URL become an
 * error — with a message that says what to do about it.
 *
 * The URL must be the *pooled* Neon endpoint (`-pooler` in the hostname).
 * Serverless functions each open their own connection, so the direct endpoint
 * runs out of connections under concurrency while the CPU sits idle.
 */

let cached: ReturnType<typeof create> | null = null;

function create() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the pooled Neon connection string to .env.local."
    );
  }

  return drizzle(neon(url), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}

/** Whether the database is configured at all, for callers that can degrade. */
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);
