import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export type Row = Record<string, any>;
export interface Queryable {
  query(sql: string, params?: any[]): Promise<{
    rows: Row[];
    rowCount?: number | null
  }>
}
export interface Database extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>
}
export async function createDatabase(config: {
  url?: string;
  embedded?: string | boolean
}): Promise<Database> {
  if (config.embedded) {
    if (typeof config.embedded === "string")
      await mkdir(dirname(config.embedded), { recursive: true });
    const p = new PGlite(typeof config.embedded === "string" ? config.embedded : undefined);
    await p.waitReady;
    return {
      query: async (s, v) => v ? p.query<Row>(s, v) : ((await p.exec(s)).at(-1) as any) || { rows: [] },
      tx: fn => p.transaction(tx => fn({ query: async (s, v) => v ? tx.query<Row>(s, v) : ((await tx.exec(s)).at(-1) as any) || { rows: [] } })),
      close: () => p.close()
    };
  }
  if (!config.url)
    throw new Error("DATABASE_URL is required. Embedded PostgreSQL is for explicit local preview/testing only.");
  const pool = new pg.Pool({ connectionString: config.url, max: 10 });
  return { query: (s, v) => pool.query(s, v), async tx(fn) { const c = await pool.connect(); try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    }
    catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    finally {
      c.release();
    } }, close: () => pool.end() };
}
export async function migrate(db: Database) {
  const sql = await readFile(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8").catch(() => readFile(fileURLToPath(new URL("../src/schema.sql", import.meta.url)), "utf8"));
  await db.tx(async q => {
    await q.query("SELECT pg_advisory_xact_lock(731620)");
    await q.query(sql);
  });
}
export async function one(
  q: Queryable,
  sql: string,
  args: any[] = []
) {
  return (await q.query(sql, args)).rows[0];
}
