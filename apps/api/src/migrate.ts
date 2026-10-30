import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase, migrate } from "./db.js";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const db = await createDatabase({ url: process.env.DATABASE_URL });
await migrate(db);
await db.close();
console.log("Database schema ready.");
