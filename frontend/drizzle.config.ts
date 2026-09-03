

import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs as a plain Node script, outside Next — so it doesn't get
 * Next's automatic .env.local loading and has to be pointed at the file.
 */
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
