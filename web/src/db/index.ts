import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

// DATABASE_URL is the Neon connection string. "pglite:<dir>" runs an embedded
// Postgres instead, for testing without Neon.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

function connect(): NodePgDatabase<typeof schema> {
  if (url!.startsWith("pglite:")) {
    // Same query API; cast so callers see one type.
    return drizzlePglite(url!.slice("pglite:".length), { schema }) as unknown as NodePgDatabase<typeof schema>;
  }
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzlePg(pool, { schema });
}

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof connect> };
export const db = (globalForDb.db ??= connect());
export * as t from "./schema";

// Query helpers re-exported so the agent uses this same drizzle copy.
export * from "drizzle-orm";
