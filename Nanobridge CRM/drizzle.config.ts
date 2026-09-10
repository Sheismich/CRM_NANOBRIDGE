import { defineConfig } from "drizzle-kit";

// Solo para herramientas de introspección/estudio (npm run db:studio).
// Las migraciones reales siguen viviendo en src/database/migrations/*.sql
// y se aplican con `npm run migrate` (src/database/migrate.ts), no con
// `drizzle-kit generate` ni `drizzle-kit push`.
export default defineConfig({
  dialect: "mysql",
  schema: "./src/database/schema.ts",
  out: "./src/database/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://crm_user:change_me@127.0.0.1:3306/nanobridge_crm"
  }
});
