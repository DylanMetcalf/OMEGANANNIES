import pg from "pg";
/** Demo DB only (guarded in global-setup): clear sign-in throttling so a full suite run isn't locked out by its own logins. */
export async function resetLoginLimits() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://omega:omega@localhost:5432/omega" });
  await c.connect();
  try { await c.query("DELETE FROM rate_limits WHERE key LIKE 'login:%'"); } finally { await c.end(); }
}
