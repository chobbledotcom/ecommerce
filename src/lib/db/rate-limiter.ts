/**
 * Generic IP-based rate limiter factory
 *
 * Creates rate limiting functions for a specific database table.
 * Used by both login and checkout rate limiting.
 */

import { hmacHash } from "#lib/crypto.ts";
import { executeByField, getDb, queryOne } from "#lib/db/client.ts";

type AttemptRow = { attempts: number; locked_until: number | null };

type RateLimiterConfig = {
  table: string;
  maxAttempts: number;
  lockoutDurationMs: number;
};

/**
 * Create rate limiting functions for a given table.
 *
 * The table must have columns: ip TEXT PRIMARY KEY, attempts INTEGER, locked_until INTEGER.
 */
export const createRateLimiter = (config: RateLimiterConfig) => {
  const { table, maxAttempts, lockoutDurationMs } = config;

  /** Delete all rows whose lockout has expired — prevents unbounded table growth */
  const purgeExpired = async (): Promise<number> => {
    const result = await getDb().execute({
      sql: `DELETE FROM ${table} WHERE locked_until IS NOT NULL AND locked_until <= ?`,
      args: [Date.now()],
    });
    return result.rowsAffected;
  };

  /** Hash IP and query attempts, then apply handler function */
  const withHashedIpAttempts = async <T>(
    ip: string,
    handler: (hashedIp: string, row: AttemptRow | null) => Promise<T>,
  ): Promise<T> => {
    const hashedIp = await hmacHash(ip);
    const row = await queryOne<AttemptRow>(
      `SELECT attempts, locked_until FROM ${table} WHERE ip = ?`,
      [hashedIp],
    );
    return handler(hashedIp, row);
  };

  /** Check if IP is currently rate limited */
  const isRateLimited = (ip: string): Promise<boolean> =>
    withHashedIpAttempts(ip, async (hashedIp, row) => {
      if (!row) return false;

      if (row.locked_until && row.locked_until > Date.now()) {
        return true;
      }

      if (row.locked_until && row.locked_until <= Date.now()) {
        await executeByField(table, "ip", hashedIp);
      }

      return false;
    });

  /** Record an attempt. Returns true if the IP is now locked out. */
  const recordAttempt = async (ip: string): Promise<boolean> => {
    // Purge expired lockouts first so the subsequent read sees clean data
    await purgeExpired();

    return withHashedIpAttempts(ip, async (hashedIp, row) => {
      const newAttempts = (row?.attempts ?? 0) + 1;

      if (newAttempts >= maxAttempts) {
        const lockedUntil = Date.now() + lockoutDurationMs;
        await getDb().execute({
          sql: `INSERT OR REPLACE INTO ${table} (ip, attempts, locked_until) VALUES (?, ?, ?)`,
          args: [hashedIp, newAttempts, lockedUntil],
        });
        return true;
      }

      await getDb().execute({
        sql: `INSERT OR REPLACE INTO ${table} (ip, attempts, locked_until) VALUES (?, ?, NULL)`,
        args: [hashedIp, newAttempts],
      });
      return false;
    });
  };

  /** Clear attempts for an IP */
  const clearAttempts = async (ip: string): Promise<void> => {
    const hashedIp = await hmacHash(ip);
    await executeByField(table, "ip", hashedIp);
  };

  return { isRateLimited, recordAttempt, clearAttempts, purgeExpired };
};
