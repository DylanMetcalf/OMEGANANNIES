import pg from "pg";
/** Demo DB only: clear login rate-limit counters so repeated E2E sign-ins aren't throttled. */
export default async function globalSetup() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://omega:omega@localhost:5432/omega" });
  await c.connect();
  const { rows } = await c.query("SELECT count(*)::int AS n FROM users WHERE is_demo = false");
  if (rows[0].n > 0) throw new Error("E2E must run against the demo database only");
  await c.query("DELETE FROM rate_limits");
  await c.end();
}
