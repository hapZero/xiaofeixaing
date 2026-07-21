import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./infra/postgres/migrations",
  schema: "./packages/database/src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://xiaofeixiang:xiaofeixiang_local@localhost:5432/xiaofeixiang",
  },
});
