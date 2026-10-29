import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Fixed-window limiter backed by Postgres so it works across serverless instances. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const r = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`);
  return Number(r.rows[0].count) <= limit;
}
