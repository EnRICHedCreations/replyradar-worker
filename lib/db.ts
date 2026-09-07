import { Pool, type PoolClient } from "pg";
let instance: Pool | undefined;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured.");
  return (instance ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 8000,
    statement_timeout: 60000,
    ...(process.env.DATABASE_CA_CERT
      ? { ssl: { ca: process.env.DATABASE_CA_CERT, rejectUnauthorized: true } }
      : {}),
  }));
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const c = await db().connect();
  try {
    await c.query("begin");
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
export async function accountLock(c: PoolClient, id: string) {
  await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
}
