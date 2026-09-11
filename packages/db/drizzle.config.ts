import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// Repo-root .env, not packages/db/.env — DATABASE_URL lives in D:\BOLT\.env.
loadEnv({ path: resolve(__dirname, "..", "..", ".env") });

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
} satisfies Config;
