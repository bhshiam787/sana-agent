import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "";
const pglite = url.startsWith("pglite:");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(pglite ? { driver: "pglite" as const } : {}),
  dbCredentials: { url: pglite ? url.slice("pglite:".length) : url },
});
