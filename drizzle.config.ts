import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env. In Docker there is no .env and the variables
// come from the environment, so a missing file is fine.
config({ quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: ["./db/schema.ts", "./db/auth-schema.ts"],
  out: "./db/migrations",
  dbCredentials: {
    // Neon on Vercel sets both. Migrations need the direct connection, not the pooler.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
