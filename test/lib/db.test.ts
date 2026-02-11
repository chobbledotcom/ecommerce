import { afterEach, beforeEach, describe, expect, jest, test } from "#test-compat";
import { getDb, setDb } from "#lib/db/client.ts";
import {
  isCheckoutRateLimited,
  recordCheckoutAttempt,
} from "#lib/db/checkout-attempts.ts";
import {
  clearLoginAttempts,
  isLoginRateLimited,
  recordFailedLogin,
} from "#lib/db/login-attempts.ts";
import { initDb } from "#lib/db/migrations/index.ts";
import {
  createSession,
  deleteAllSessions,
  deleteOtherSessions,
  deleteSession,
  getAllSessions,
  getSession,
  resetSessionCache,
} from "#lib/db/sessions.ts";
import {
  clearPaymentProvider,
  CONFIG_KEYS,
  completeSetup,
  getCurrencyCodeFromDb,
  getPublicKey,
  getSetting,
  getStripeSecretKeyFromDb,
  getWrappedPrivateKey,
  hasStripeKey,
  isSetupComplete,
  setPaymentProvider,
  setSetting,
  updateStripeKey,
} from "#lib/db/settings.ts";
import { getUserByUsername, verifyUserPassword } from "#lib/db/users.ts";
import {
  createTestDbWithSetup,
  createTestProduct,
  resetDb,
  TEST_ADMIN_PASSWORD,
  TEST_ADMIN_USERNAME,
} from "#test-utils";

describe("db", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("getDb", () => {
    test("throws error when DB_URL is not set", () => {
      setDb(null);
      const originalDbUrl = Deno.env.get("DB_URL");
      Deno.env.delete("DB_URL");

      try {
        expect(() => getDb()).toThrow(
          "DB_URL environment variable is required",
        );
      } finally {
        if (originalDbUrl) {
          Deno.env.set("DB_URL", originalDbUrl);
        }
      }
    });
  });

  describe("settings", () => {
    test("getSetting returns null for missing key", async () => {
      const value = await getSetting("missing");
      expect(value).toBeNull();
    });

    test("setSetting and getSetting work together", async () => {
      await setSetting("test_key", "test_value");
      const value = await getSetting("test_key");
      expect(value).toBe("test_value");
    });

    test("setSetting overwrites existing value", async () => {
      await setSetting("key", "value1");
      await setSetting("key", "value2");
      const value = await getSetting("key");
      expect(value).toBe("value2");
    });
  });

  describe("setup", () => {
    test("completeSetup sets all config values and generates key hierarchy", async () => {
      // Delete existing user from createTestDbWithSetup to test fresh setup
      await getDb().execute("DELETE FROM users");
      await getDb().execute("DELETE FROM settings");
      await completeSetup("setupuser", "mypassword", "USD");

      expect(await isSetupComplete()).toBe(true);
      // Password is now stored on the user row, verify via user-based API
      const user = await getUserByUsername("setupuser");
      expect(user).not.toBeNull();
      const hash = await verifyUserPassword(user!, "mypassword");
      expect(hash).toBeTruthy();
      expect(hash).toContain("pbkdf2:");
      expect(await getCurrencyCodeFromDb()).toBe("USD");

      // Key hierarchy should be generated
      expect(await getPublicKey()).toBeTruthy();
      expect(user!.wrapped_data_key).toBeTruthy();
      expect(await getWrappedPrivateKey()).toBeTruthy();
    });

    test("CONFIG_KEYS values are usable as database setting keys", async () => {
      for (const key of Object.values(CONFIG_KEYS)) {
        await setSetting(key, "test-value");
        const value = await getSetting(key);
        expect(value).toBe("test-value");
      }
    });

    test("getCurrencyCodeFromDb returns GBP by default", async () => {
      expect(await getCurrencyCodeFromDb()).toBe("GBP");
    });
  });

  describe("stripe key", () => {
    test("hasStripeKey returns false when not set", async () => {
      expect(await hasStripeKey()).toBe(false);
    });

    test("hasStripeKey returns true after setting key", async () => {
      await updateStripeKey("sk_test_123");
      expect(await hasStripeKey()).toBe(true);
    });

    test("getStripeSecretKeyFromDb returns null when not set", async () => {
      expect(await getStripeSecretKeyFromDb()).toBeNull();
    });

    test("getStripeSecretKeyFromDb returns decrypted key after setting", async () => {
      await updateStripeKey("sk_test_secret_key");
      const key = await getStripeSecretKeyFromDb();
      expect(key).toBe("sk_test_secret_key");
    });

    test("updateStripeKey stores key encrypted", async () => {
      await updateStripeKey("sk_test_encrypted");
      // Verify the raw value in DB is encrypted (starts with enc:1:)
      const rawValue = await getSetting(CONFIG_KEYS.STRIPE_SECRET_KEY);
      expect(rawValue).toMatch(/^enc:1:/);
      // But getStripeSecretKeyFromDb returns decrypted
      expect(await getStripeSecretKeyFromDb()).toBe("sk_test_encrypted");
    });

    test("updateStripeKey overwrites existing key", async () => {
      await updateStripeKey("sk_test_first");
      expect(await getStripeSecretKeyFromDb()).toBe("sk_test_first");

      await updateStripeKey("sk_test_second");
      expect(await getStripeSecretKeyFromDb()).toBe("sk_test_second");
    });
  });

  describe("admin password", () => {
    test("verifyUserPassword returns hash for correct password", async () => {
      // Use the user created by createTestDbWithSetup
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();
      const result = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);
      expect(result).toBeTruthy();
      expect(result).toContain("pbkdf2:");
    });

    test("verifyUserPassword returns null for wrong password", async () => {
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();
      const result = await verifyUserPassword(user!, "wrong");
      expect(result).toBeNull();
    });

    test("updateUserPassword re-wraps DATA_KEY with new KEK", async () => {
      // Use the user from createTestDbWithSetup
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();
      const oldWrappedKey = user!.wrapped_data_key;

      const oldHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);
      expect(oldHash).toBeTruthy();

      const { updateUserPassword } = await import("#lib/db/settings.ts");
      const success = await updateUserPassword(
        user!.id,
        oldHash!,
        user!.wrapped_data_key!,
        "newpassword456",
      );
      expect(success).toBe(true);

      // Wrapped key should be different (re-wrapped with new KEK)
      const updatedUser = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(updatedUser!.wrapped_data_key).not.toBe(oldWrappedKey);

      // Old password should no longer work
      expect(await verifyUserPassword(updatedUser!, TEST_ADMIN_PASSWORD)).toBeNull();

      // New password should work
      expect(await verifyUserPassword(updatedUser!, "newpassword456")).toBeTruthy();
    });

    test("updateUserPassword fails with wrong old password hash", async () => {
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();

      const { updateUserPassword } = await import("#lib/db/settings.ts");
      // Pass a bogus password hash - KEK derivation will produce wrong key
      const success = await updateUserPassword(
        user!.id,
        "pbkdf2:bogus:hash",
        user!.wrapped_data_key!,
        "newpassword",
      );
      expect(success).toBe(false);

      // Original password should still work
      const unchanged = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(await verifyUserPassword(unchanged!, TEST_ADMIN_PASSWORD)).toBeTruthy();
    });
  });

  describe("getDb", () => {
    test("creates client when db is null", () => {
      setDb(null);
      const originalDbUrl = Deno.env.get("DB_URL");
      Deno.env.set("DB_URL", ":memory:");

      const client = getDb();
      expect(client).toBeDefined();

      if (originalDbUrl) {
        Deno.env.set("DB_URL", originalDbUrl);
      } else {
        Deno.env.delete("DB_URL");
      }
    });

    test("returns existing client when db is set", () => {
      const client1 = getDb();
      const client2 = getDb();
      expect(client1).toBe(client2);
    });
  });

  describe("sessions", () => {
    test("createSession and getSession work together", async () => {
      const expires = Date.now() + 1000;
      await createSession("test-token", "test-csrf-token", expires, null, 1);

      const session = await getSession("test-token");
      expect(session).not.toBeNull();
      // Token is hashed in storage, verify by csrf_token and expires
      expect(session?.csrf_token).toBe("test-csrf-token");
      expect(session?.expires).toBe(expires);
    });

    test("getSession returns null for missing session", async () => {
      const session = await getSession("nonexistent");
      expect(session).toBeNull();
    });

    test("deleteSession removes session", async () => {
      await createSession("delete-me", "csrf-delete", Date.now() + 1000, null, 1);
      await deleteSession("delete-me");

      const session = await getSession("delete-me");
      expect(session).toBeNull();
    });

    test("deleteAllSessions removes all sessions", async () => {
      await createSession("session1", "csrf1", Date.now() + 10000, null, 1);
      await createSession("session2", "csrf2", Date.now() + 10000, null, 1);
      await createSession("session3", "csrf3", Date.now() + 10000, null, 1);

      await deleteAllSessions();

      const session1 = await getSession("session1");
      const session2 = await getSession("session2");
      const session3 = await getSession("session3");

      expect(session1).toBeNull();
      expect(session2).toBeNull();
      expect(session3).toBeNull();
    });

    test("getAllSessions returns all sessions ordered by expiration descending", async () => {
      const now = Date.now();
      await createSession("session1", "csrf1", now + 1000, null, 1);
      await createSession("session2", "csrf2", now + 3000, null, 1);
      await createSession("session3", "csrf3", now + 2000, null, 1);

      const sessions = await getAllSessions();

      expect(sessions.length).toBe(3);
      // Token is hashed, verify order by csrf_token
      expect(sessions[0]?.csrf_token).toBe("csrf2"); // Newest first (highest expiry)
      expect(sessions[1]?.csrf_token).toBe("csrf3");
      expect(sessions[2]?.csrf_token).toBe("csrf1"); // Oldest last (lowest expiry)
    });

    test("getAllSessions returns empty array when no sessions", async () => {
      const sessions = await getAllSessions();
      expect(sessions).toEqual([]);
    });

    test("deleteOtherSessions removes all sessions except current", async () => {
      await createSession("current", "csrf-current", Date.now() + 10000, null, 1);
      await createSession("other1", "csrf-other1", Date.now() + 10000, null, 1);
      await createSession("other2", "csrf-other2", Date.now() + 10000, null, 1);

      await deleteOtherSessions("current");

      const currentSession = await getSession("current");
      const other1 = await getSession("other1");
      const other2 = await getSession("other2");

      expect(currentSession).not.toBeNull();
      expect(other1).toBeNull();
      expect(other2).toBeNull();
    });

    test("deleteOtherSessions with no other sessions keeps current", async () => {
      await createSession("only-session", "csrf", Date.now() + 10000, null, 1);

      await deleteOtherSessions("only-session");

      const session = await getSession("only-session");
      expect(session).not.toBeNull();
    });

    test("getSession expires cached entry after TTL", async () => {
      // Use fake timers to control Date.now()
      jest.useFakeTimers();
      const startTime = Date.now();
      jest.setSystemTime(startTime);

      // Create and cache a session
      await createSession("ttl-test", "csrf-ttl", startTime + 60000, null, 1);
      const firstCall = await getSession("ttl-test");
      expect(firstCall).not.toBeNull();

      // Advance time past the 10-second TTL
      jest.setSystemTime(startTime + 11000);

      // Reset session cache to clear it, then re-cache with old timestamp
      // by manipulating time backwards to simulate an old cache entry
      resetSessionCache();

      // Re-cache the session at the original time
      jest.setSystemTime(startTime);
      await getSession("ttl-test"); // This caches with startTime

      // Now advance time past TTL again
      jest.setSystemTime(startTime + 11000);

      // This call should find the expired cache entry, delete it, and re-query DB
      const afterTtl = await getSession("ttl-test");
      expect(afterTtl).not.toBeNull();
      expect(afterTtl?.csrf_token).toBe("csrf-ttl");

      // Restore real timers
      jest.useRealTimers();
    });
  });

  describe("updateUserPassword", () => {
    test("new password works after update", async () => {
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      const initialHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);

      const { updateUserPassword } = await import("#lib/db/settings.ts");
      await updateUserPassword(user!.id, initialHash!, user!.wrapped_data_key!, "new-password-123");

      const updatedUser = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(await verifyUserPassword(updatedUser!, "new-password-123")).toBeTruthy();
    });

    test("old password no longer works after update", async () => {
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      const initialHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);

      const { updateUserPassword } = await import("#lib/db/settings.ts");
      await updateUserPassword(user!.id, initialHash!, user!.wrapped_data_key!, "new-password-123");

      const updatedUser = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(await verifyUserPassword(updatedUser!, TEST_ADMIN_PASSWORD)).toBeNull();
    });

    test("invalidates all sessions after password update", async () => {
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      const initialHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);

      await createSession("session1", "csrf1", Date.now() + 10000, null, 1);
      await createSession("session2", "csrf2", Date.now() + 10000, null, 1);

      const { updateUserPassword } = await import("#lib/db/settings.ts");
      await updateUserPassword(user!.id, initialHash!, user!.wrapped_data_key!, "new-password-123");

      expect(await getSession("session1")).toBeNull();
      expect(await getSession("session2")).toBeNull();
    });
  });

  describe("rate limiting", () => {
    test("isLoginRateLimited returns false for new IP", async () => {
      const limited = await isLoginRateLimited("192.168.1.1");
      expect(limited).toBe(false);
    });

    test("recordFailedLogin increments attempts", async () => {
      const locked1 = await recordFailedLogin("192.168.1.2");
      expect(locked1).toBe(false);

      const locked2 = await recordFailedLogin("192.168.1.2");
      expect(locked2).toBe(false);
    });

    test("recordFailedLogin locks after threshold is reached", async () => {
      // Record attempts until locked — the exact threshold is an implementation detail
      let locked = false;
      let attempts = 0;
      while (!locked && attempts < 100) {
        locked = await recordFailedLogin("192.168.1.3");
        attempts++;
      }
      expect(locked).toBe(true);
      expect(attempts).toBeGreaterThan(1); // Should require multiple failures
    });

    test("isLoginRateLimited returns true when locked", async () => {
      // Lock the IP by recording failures until locked
      let locked = false;
      while (!locked) {
        locked = await recordFailedLogin("192.168.1.4");
      }

      const limited = await isLoginRateLimited("192.168.1.4");
      expect(limited).toBe(true);
    });

    test("clearLoginAttempts clears attempts", async () => {
      await recordFailedLogin("192.168.1.5");
      await recordFailedLogin("192.168.1.5");

      await clearLoginAttempts("192.168.1.5");

      // After clearing, should not be limited
      const limited = await isLoginRateLimited("192.168.1.5");
      expect(limited).toBe(false);
    });

    test("isLoginRateLimited clears expired lockout", async () => {
      // Insert a record with expired lockout
      await getDb().execute({
        sql: "INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, ?, ?)",
        args: ["192.168.1.6", 5, Date.now() - 1000],
      });

      // Should clear the expired lockout and return false
      const limited = await isLoginRateLimited("192.168.1.6");
      expect(limited).toBe(false);
    });

    test("isLoginRateLimited returns false for attempts below max without lockout", async () => {
      // Insert a record with some attempts but no lockout
      await getDb().execute({
        sql: "INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, ?, NULL)",
        args: ["192.168.1.7", 3],
      });

      const limited = await isLoginRateLimited("192.168.1.7");
      expect(limited).toBe(false);
    });
  });

  describe("login-attempts - expired lockout", () => {
    test("isLoginRateLimited resets expired lockout and returns false", async () => {
      // Insert a record with locked_until in the past
      await getDb().execute({
        sql: "INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, ?, ?)",
        args: ["expired-ip-hash", 5, Date.now() - 60000],
      });

      // This uses the raw hashed IP - we need to test via the public API
      // The existing test at line 993 already covers this via isLoginRateLimited
      // But let's verify that after the expired lockout reset, new attempts work
      const ip = "192.168.99.1";

      // Lock the IP by recording failures until locked
      let locked = false;
      while (!locked) {
        locked = await recordFailedLogin(ip);
      }
      expect(await isLoginRateLimited(ip)).toBe(true);

      // Simulate expired lockout by manipulating the DB directly
      await getDb().execute({
        sql: "UPDATE login_attempts SET locked_until = ? WHERE locked_until IS NOT NULL",
        args: [Date.now() - 1000],
      });

      // Should detect expired lockout, clear it, and return false
      const limited = await isLoginRateLimited(ip);
      expect(limited).toBe(false);

      // Verify the record was cleared - can fail new attempts again
      const lockedAgain = await recordFailedLogin(ip);
      expect(lockedAgain).toBe(false);
    });
  });

  describe("checkout rate limiting", () => {
    test("isCheckoutRateLimited returns false for new IP", async () => {
      const limited = await isCheckoutRateLimited("10.0.0.1");
      expect(limited).toBe(false);
    });

    test("recordCheckoutAttempt locks after enough attempts", async () => {
      const ip = "10.0.0.2";
      let locked = false;
      let attempts = 0;
      while (!locked) {
        locked = await recordCheckoutAttempt(ip);
        attempts++;
      }
      expect(locked).toBe(true);
      expect(attempts).toBeGreaterThan(1);
    });

    test("isCheckoutRateLimited returns true when locked", async () => {
      const ip = "10.0.0.3";
      let locked = false;
      while (!locked) {
        locked = await recordCheckoutAttempt(ip);
      }

      const limited = await isCheckoutRateLimited(ip);
      expect(limited).toBe(true);
    });

    test("isCheckoutRateLimited clears expired lockout", async () => {
      const ip = "10.0.0.4";

      // Lock the IP by recording attempts until locked
      let locked = false;
      while (!locked) {
        locked = await recordCheckoutAttempt(ip);
      }
      expect(await isCheckoutRateLimited(ip)).toBe(true);

      // Simulate expired lockout by manipulating the DB directly
      await getDb().execute({
        sql: "UPDATE checkout_attempts SET locked_until = ? WHERE locked_until IS NOT NULL",
        args: [Date.now() - 1000],
      });

      // Should detect expired lockout, clear it, and return false
      const limited = await isCheckoutRateLimited(ip);
      expect(limited).toBe(false);

      // Verify the record was cleared - can record new attempts again
      const lockedAgain = await recordCheckoutAttempt(ip);
      expect(lockedAgain).toBe(false);
    });

    test("isCheckoutRateLimited returns false for attempts below max without lockout", async () => {
      // Record a few attempts without reaching the limit
      await recordCheckoutAttempt("10.0.0.5");
      await recordCheckoutAttempt("10.0.0.5");

      const limited = await isCheckoutRateLimited("10.0.0.5");
      expect(limited).toBe(false);
    });

    test("recordCheckoutAttempt purges expired lockouts from other IPs", async () => {
      // Insert an expired lockout for a different IP directly into the DB
      await getDb().execute({
        sql: "INSERT INTO checkout_attempts (ip, attempts, locked_until) VALUES (?, ?, ?)",
        args: ["stale-hash-1", 10, Date.now() - 1000],
      });
      await getDb().execute({
        sql: "INSERT INTO checkout_attempts (ip, attempts, locked_until) VALUES (?, ?, ?)",
        args: ["stale-hash-2", 10, Date.now() - 2000],
      });

      // Verify stale rows exist
      const before = await getDb().execute("SELECT COUNT(*) as count FROM checkout_attempts");
      expect((before.rows[0] as unknown as { count: number }).count).toBe(2);

      // Recording an attempt should purge the expired lockouts
      await recordCheckoutAttempt("10.0.0.6");

      // Only the new IP's row should remain
      const after = await getDb().execute("SELECT COUNT(*) as count FROM checkout_attempts");
      expect((after.rows[0] as unknown as { count: number }).count).toBe(1);
    });
  });

  describe("login rate limiting purges expired records", () => {
    test("recordFailedLogin purges expired lockouts from other IPs", async () => {
      // Insert an expired lockout directly into the DB
      await getDb().execute({
        sql: "INSERT INTO login_attempts (ip, attempts, locked_until) VALUES (?, ?, ?)",
        args: ["stale-login-hash", 5, Date.now() - 1000],
      });

      const before = await getDb().execute("SELECT COUNT(*) as count FROM login_attempts");
      expect((before.rows[0] as unknown as { count: number }).count).toBe(1);

      // Recording an attempt should purge the expired lockout
      await recordFailedLogin("192.168.50.1");

      // Only the new IP's row should remain
      const after = await getDb().execute("SELECT COUNT(*) as count FROM login_attempts");
      expect((after.rows[0] as unknown as { count: number }).count).toBe(1);
    });
  });

  describe("settings - additional coverage", () => {
    test("clearPaymentProvider removes payment provider setting", async () => {
      await setPaymentProvider("stripe");
      expect(await getSetting(CONFIG_KEYS.PAYMENT_PROVIDER)).toBe("stripe");

      await clearPaymentProvider();
      expect(await getSetting(CONFIG_KEYS.PAYMENT_PROVIDER)).toBeNull();
    });

    test("updateUserPassword returns false when dataKey unwrap fails", async () => {
      // Use the user from createTestDbWithSetup
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();
      const passwordHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);
      expect(passwordHash).toBeTruthy();

      // Pass corrupted wrapped_data_key - unwrap will fail
      const { updateUserPassword } = await import("#lib/db/settings.ts");
      const result = await updateUserPassword(
        user!.id,
        passwordHash!,
        "corrupted_wrapped_data_key",
        "newpassword",
      );
      expect(result).toBe(false);
    });
  });

  describe("table utilities - non-generated primary key", () => {
    test("insert with non-generated primary key uses empty initial row", async () => {
      const { col, defineTable } = await import("#lib/db/table.ts");

      // Create a table where the primary key is NOT generated (user-supplied)
      await getDb().execute(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      type KvRow = { key: string; value: string };
      type KvInput = { key: string; value: string };
      const kvTable = defineTable<KvRow, KvInput>({
        name: "kv_store",
        primaryKey: "key",
        schema: {
          key: col.simple<string>(),
          value: col.simple<string>(),
        },
      });

      const row = await kvTable.insert({ key: "test-key", value: "test-value" });
      expect(row.key).toBe("test-key");
      expect(row.value).toBe("test-value");

      // Verify it was actually stored
      const fetched = await kvTable.findById("test-key");
      expect(fetched).not.toBeNull();
      expect(fetched?.value).toBe("test-value");
    });
  });

  describe("multi-user admin migration", () => {
    test("migrates existing admin_password from settings to users table", async () => {
      const { hashPassword, decrypt } = await import("#lib/crypto.ts");

      // Simulate pre-migration state: admin credentials in settings, no users
      const passwordHash = await hashPassword("existingpassword");
      await setSetting("admin_password", passwordHash);
      await setSetting("wrapped_data_key", "test-wrapped-key");
      await getDb().execute("DELETE FROM users");

      // Force re-migration
      await getDb().execute(
        "UPDATE settings SET value = 'outdated' WHERE key = 'latest_db_update'",
      );
      await initDb();

      // Verify an owner user was created
      const rows = await getDb().execute("SELECT * FROM users");
      expect(rows.rows.length).toBe(1);

      const user = rows.rows[0] as unknown as { password_hash: string; wrapped_data_key: string; admin_level: string };
      const decryptedLevel = await decrypt(user.admin_level);
      expect(decryptedLevel).toBe("owner");
      expect(user.wrapped_data_key).toBe("test-wrapped-key");

      // Verify the password hash was encrypted (not stored raw)
      const decryptedHash = await decrypt(user.password_hash);
      expect(decryptedHash).toBe(passwordHash);
    });

    test("skips migration when users already exist", async () => {
      // createTestDbWithSetup already created a user
      await setSetting("admin_password", "old-hash");
      await setSetting("wrapped_data_key", "old-key");

      const beforeCount = await getDb().execute("SELECT COUNT(*) as count FROM users");
      const countBefore = (beforeCount.rows[0] as unknown as { count: number }).count;

      // Force re-migration
      await getDb().execute(
        "UPDATE settings SET value = 'outdated' WHERE key = 'latest_db_update'",
      );
      await initDb();

      // Verify no additional user was created
      const afterCount = await getDb().execute("SELECT COUNT(*) as count FROM users");
      expect((afterCount.rows[0] as unknown as { count: number }).count).toBe(countBefore);
    });

    test("skips migration when no admin_password in settings", async () => {
      // Remove all users and ensure no admin_password setting exists
      await getDb().execute("DELETE FROM users");

      // Force re-migration
      await getDb().execute(
        "UPDATE settings SET value = 'outdated' WHERE key = 'latest_db_update'",
      );
      await initDb();

      // Verify no user was created
      const rows = await getDb().execute("SELECT COUNT(*) as count FROM users");
      expect((rows.rows[0] as unknown as { count: number }).count).toBe(0);
    });
  });


  describe("initDb idempotent", () => {
    test("initDb is idempotent - second call is a no-op", async () => {
      // First initDb already ran in createTestDbWithSetup, run again
      await initDb(); // Should be a no-op due to isDbUpToDate check
      // Verify settings are still intact
      const result = await getDb().execute(
        "SELECT value FROM settings WHERE key = 'latest_db_update'",
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe("table CRUD operations", () => {
    test("findAll returns all rows", async () => {
      const { productsTable } = await import("#lib/db/products.ts");
      await createTestProduct({ sku: "ALL-1" });
      await createTestProduct({ sku: "ALL-2" });
      const all = await productsTable.findAll();
      expect(all.length).toBe(2);
    });

    test("findById returns null for non-existent row", async () => {
      const { productsTable } = await import("#lib/db/products.ts");
      const result = await productsTable.findById(99999);
      expect(result).toBeNull();
    });

    test("update returns null for non-existent row", async () => {
      const { productsTable } = await import("#lib/db/products.ts");
      const result = await productsTable.update(99999, { name: "Nope" });
      expect(result).toBeNull();
    });

    test("update with no fields returns current row", async () => {
      const product = await createTestProduct({ sku: "NOOP-1" });
      const { productsTable } = await import("#lib/db/products.ts");
      const result = await productsTable.update(product.id, {});
      expect(result).not.toBeNull();
      expect(result!.sku).toBe("NOOP-1");
    });

    test("update modifies specific fields", async () => {
      const product = await createTestProduct({ sku: "UPD-TBL", name: "Old" });
      const { productsTable } = await import("#lib/db/products.ts");
      const result = await productsTable.update(product.id, { name: "New" });
      expect(result).not.toBeNull();
      expect(result!.name).toBe("New");
      expect(result!.sku).toBe("UPD-TBL");
    });

    test("deleteById removes a row", async () => {
      const product = await createTestProduct({ sku: "DEL-TBL" });
      const { productsTable } = await import("#lib/db/products.ts");
      await productsTable.deleteById(product.id);
      const result = await productsTable.findById(product.id);
      expect(result).toBeNull();
    });

    test("table with encrypted columns encrypts and decrypts", async () => {
      const { logActivity, getAllActivityLog } = await import("#lib/db/activityLog.ts");
      await logActivity("Secret message");
      const entries = await getAllActivityLog();
      expect(entries[0]!.message).toBe("Secret message");
    });

    test("toDbValues applies defaults and write transforms", async () => {
      const { productsTable } = await import("#lib/db/products.ts");
      const dbValues = await productsTable.toDbValues({
        sku: "TV-1",
        name: "Test",
        unitPrice: 100,
      } as { sku: string; name: string; unitPrice: number });
      expect(dbValues.sku).toBe("TV-1");
      expect(dbValues.name).toBe("Test");
      expect(dbValues.unit_price).toBe(100);
      // Default fields should have values
      expect(dbValues.description).toBe("");
      expect(dbValues.stock).toBe(0);
      expect(dbValues.active).toBe(1);
      expect(dbValues.created).toBeDefined();
    });

    test("col helpers work correctly", async () => {
      const { col, defineTable } = await import("#lib/db/table.ts");

      // Create a simple test table
      await getDb().execute(`
        CREATE TABLE IF NOT EXISTS test_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created TEXT NOT NULL
        )
      `);

      const testTable = defineTable<
        { id: number; name: string; created: string },
        { name: string; created?: string }
      >({
        name: "test_items",
        primaryKey: "id",
        schema: {
          id: col.generated<number>(),
          name: col.simple<string>(),
          created: col.timestamp(),
        },
      });

      const item = await testTable.insert({ name: "Test Item" });
      expect(item.id).toBe(1);
      expect(item.name).toBe("Test Item");
      expect(item.created).toBeDefined();

      // Test findById
      const found = await testTable.findById(1);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test Item");

      // Test findAll
      await testTable.insert({ name: "Second Item" });
      const all = await testTable.findAll();
      expect(all.length).toBe(2);

      // Test deleteById
      await testTable.deleteById(1);
      const deleted = await testTable.findById(1);
      expect(deleted).toBeNull();
    });

    test("getReturnValue returns null for column not in input or dbValues", async () => {
      const { col, defineTable } = await import("#lib/db/table.ts");

      await getDb().execute(`
        CREATE TABLE IF NOT EXISTS test_nullable_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          optional_field TEXT
        )
      `);

      const nullableTable = defineTable<
        { id: number; name: string; optional_field: string | null },
        { name: string; optional_field?: string | null }
      >({
        name: "test_nullable_items",
        primaryKey: "id",
        schema: {
          id: col.generated<number>(),
          name: col.simple<string>(),
          optional_field: col.simple<string | null>(),
        },
      });

      // Insert without optional_field — getReturnValue should return null
      const item = await nullableTable.insert({ name: "Null Test" } as { name: string; optional_field?: string | null });
      expect(item.name).toBe("Null Test");
      expect(item.optional_field).toBeNull();
    });

    test("reservationsTable.insert uses withDefault for status", async () => {
      // This directly exercises the col.withDefault path on reservations.ts:31
      const { reservationsTable } = await import("#lib/db/reservations.ts");
      const product = await createTestProduct({ stock: 100 });
      const reservation = await reservationsTable.insert({
        productId: product.id,
        quantity: 1,
        providerSessionId: "direct_insert_test",
      } as { productId: number; quantity: number; providerSessionId: string });
      expect(reservation.status).toBe("pending");
    });

    test("col.encryptedNullable handles null values", async () => {
      const { col } = await import("#lib/db/table.ts");
      const encFn = (v: string) => `enc_${v}`;
      const decFn = (v: string) => v.replace("enc_", "");
      const def = col.encryptedNullable(encFn, decFn);
      // Write null
      const writeResult = await def.write!(null);
      expect(writeResult).toBeNull();
      // Read null
      const readResult = await def.read!(null);
      expect(readResult).toBeNull();
      // Write non-null
      const writeResult2 = await def.write!("hello");
      expect(writeResult2).toBe("enc_hello");
      // Read non-null
      const readResult2 = await def.read!("enc_hello");
      expect(readResult2).toBe("hello");
    });

    test("col.transform creates custom read/write transforms", async () => {
      const { col } = await import("#lib/db/table.ts");
      const def = col.transform(
        (v: number) => v * 100,
        (v: number) => v / 100,
      );
      expect(def.write!(5)).toBe(500);
      expect(def.read!(500)).toBe(5);
    });
  });

  describe("toSnakeCase and resolveValue", () => {
    test("toSnakeCase converts camelCase", async () => {
      const { toSnakeCase } = await import("#lib/db/table.ts");
      expect(toSnakeCase("myField")).toBe("my_field");
      expect(toSnakeCase("anotherFieldName")).toBe("another_field_name");
      expect(toSnakeCase("simple")).toBe("simple");
    });

    test("table insert handles missing optional fields with null fallback", async () => {
      // Insert a product with only required fields - optional ones should get defaults or null
      const { productsTable } = await import("#lib/db/products.ts");
      const product = await productsTable.insert({
        name: "Minimal",
        sku: "MIN-1",
        unitPrice: 100,
      } as Parameters<typeof productsTable.insert>[0]);
      expect(product.name).toBe("Minimal");
      expect(product.sku).toBe("MIN-1");
    });
  });
});
