import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type XiaofeixiangDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30_000 });
  return { db: drizzle(pool, { schema }), pool };
}

export * from "./schema.js";
