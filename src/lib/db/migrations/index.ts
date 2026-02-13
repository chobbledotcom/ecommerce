/**
 * Database migrations
 */

import { encrypt, hmacHash } from "#lib/crypto.ts";
import { getDb, queryOne } from "#lib/db/client.ts";
import { getSetting } from "#lib/db/settings.ts";

/**
 * The latest database update identifier - update this when changing schema
 */
export const LATEST_UPDATE = "add checkout rate limiting";

/**
 * Run a migration that may fail if already applied (e.g., adding a column that exists)
 */
const runMigration = async (sql: string): Promise<void> => {
  try {
    await getDb().execute(sql);
  } catch {
    // Migration already applied, ignore error
  }
};

/**
 * Check if database is already up to date by reading from settings table
 */
const isDbUpToDate = async (): Promise<boolean> => {
  try {
    const result = await getDb().execute(
      "SELECT value FROM settings WHERE key = 'latest_db_update'",
    );
    return result.rows[0]?.value === LATEST_UPDATE;
  } catch {
    // Table doesn't exist or other error, need to run migrations
    return false;
  }
};

/**
 * Initialize database tables
 */
export const initDb = async (): Promise<void> => {
  // Check if database is already up to date - bail early if so
  if (await isDbUpToDate()) {
    return;
  }

  // Create settings table
  await runMigration(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Create sessions table
  await runMigration(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      expires INTEGER NOT NULL,
      wrapped_data_key TEXT
    )
  `);

  // Create login_attempts table
  await runMigration(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER
    )
  `);

  // Create processed_payments table for webhook idempotency
  await runMigration(`
    CREATE TABLE IF NOT EXISTS processed_payments (
      payment_session_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    )
  `);

  // Migration: drop attendee_id column from processed_payments (legacy)
  // SQLite doesn't support DROP COLUMN before 3.35, so recreate
  await runMigration(`
    CREATE TABLE IF NOT EXISTS processed_payments_new (
      payment_session_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    )
  `);
  await runMigration(`
    INSERT OR IGNORE INTO processed_payments_new (payment_session_id, processed_at)
    SELECT payment_session_id, processed_at FROM processed_payments
    WHERE typeof(payment_session_id) = 'text'
  `);
  await runMigration(`DROP TABLE IF EXISTS processed_payments`);
  await runMigration(`ALTER TABLE processed_payments_new RENAME TO processed_payments`);

  // Create activity_log table
  await runMigration(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created TEXT NOT NULL,
      event_id INTEGER,
      message TEXT NOT NULL
    )
  `);

  // Create users table for multi-user admin access
  await runMigration(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_hash TEXT NOT NULL,
      username_index TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      wrapped_data_key TEXT,
      admin_level TEXT NOT NULL,
      invite_code_hash TEXT,
      invite_expiry TEXT
    )
  `);

  // Create unique index on username_index for fast lookups
  await runMigration(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_index ON users(username_index)`,
  );

  // Migration: migrate existing single-admin credentials to users table
  {
    const existingPasswordHash = await getSetting("admin_password");
    const existingWrappedDataKey = await getSetting("wrapped_data_key");
    // COUNT(*) always returns a row
    const countRow = await queryOne<{ count: number }>("SELECT COUNT(*) as count FROM users", []);
    const hasNoUsers = countRow!.count === 0;

    if (existingPasswordHash && hasNoUsers) {
      const username = "admin";
      const usernameIndex = await hmacHash(username);
      const encryptedUsername = await encrypt(username);
      const encryptedPasswordHash = await encrypt(existingPasswordHash);
      const encryptedAdminLevel = await encrypt("owner");

      await getDb().execute({
        sql: `INSERT INTO users (username_hash, username_index, password_hash, wrapped_data_key, admin_level)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          encryptedUsername,
          usernameIndex,
          encryptedPasswordHash,
          existingWrappedDataKey,
          encryptedAdminLevel,
        ],
      });
    }
  }

  // Migration: add user_id column to sessions
  await runMigration(`ALTER TABLE sessions ADD COLUMN user_id INTEGER`);
  await runMigration(`DELETE FROM sessions WHERE user_id IS NULL`);

  // Create products table (ecommerce catalog)
  await runMigration(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      unit_price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL
    )
  `);

  // Create stock_reservations table (tracks in-flight checkout sessions)
  await runMigration(`
    CREATE TABLE IF NOT EXISTS stock_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      provider_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // Create indexes for stock_reservations lookups
  await runMigration(
    `CREATE INDEX IF NOT EXISTS idx_reservations_session ON stock_reservations(provider_session_id)`,
  );
  await runMigration(
    `CREATE INDEX IF NOT EXISTS idx_reservations_status ON stock_reservations(status, created)`,
  );

  // Create checkout_attempts table (rate limiting for /api/checkout)
  await runMigration(`
    CREATE TABLE IF NOT EXISTS checkout_attempts (
      ip TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER
    )
  `);

  // Drop legacy ticket-era tables
  await runMigration(`DROP TABLE IF EXISTS attendees`);
  await runMigration(`DROP TABLE IF EXISTS events`);

  // Update the version marker
  await getDb().execute({
    sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('latest_db_update', ?)",
    args: [LATEST_UPDATE],
  });
};

/**
 * All database tables in order for safe dropping (respects foreign key constraints)
 */
const ALL_TABLES = [
  "stock_reservations",
  "products",
  "activity_log",
  "processed_payments",
  "sessions",
  "users",
  "login_attempts",
  "checkout_attempts",
  "settings",
] as const;

/**
 * Reset the database by dropping all tables
 */
export const resetDatabase = async (): Promise<void> => {
  const client = getDb();
  for (const table of ALL_TABLES) {
    await client.execute(`DROP TABLE IF EXISTS ${table}`);
  }
};
