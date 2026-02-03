import { afterEach, beforeEach, describe, expect, jest, test } from "#test-compat";
import { getDb, setDb } from "#lib/db/client.ts";
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

    test("CONFIG_KEYS contains expected keys", () => {
      expect(CONFIG_KEYS.CURRENCY_CODE).toBe("currency_code");
      expect(CONFIG_KEYS.SETUP_COMPLETE).toBe("setup_complete");
      expect(CONFIG_KEYS.WRAPPED_PRIVATE_KEY).toBe("wrapped_private_key");
      expect(CONFIG_KEYS.PUBLIC_KEY).toBe("public_key");
      expect(CONFIG_KEYS.STRIPE_SECRET_KEY).toBe("stripe_secret_key");
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
    test("updates password and invalidates all sessions", async () => {
      // Use user from createTestDbWithSetup
      const user = await getUserByUsername(TEST_ADMIN_USERNAME);
      expect(user).not.toBeNull();

      // Create some sessions
      await createSession("session1", "csrf1", Date.now() + 10000, null, 1);
      await createSession("session2", "csrf2", Date.now() + 10000, null, 1);

      // Verify initial password works
      const initialHash = await verifyUserPassword(user!, TEST_ADMIN_PASSWORD);
      expect(initialHash).toBeTruthy();

      // Update password using user-based API
      const { updateUserPassword } = await import("#lib/db/settings.ts");
      const success = await updateUserPassword(
        user!.id,
        initialHash!,
        user!.wrapped_data_key!,
        "new-password-123",
      );
      expect(success).toBe(true);

      // Verify new password works
      const updatedUser = await getUserByUsername(TEST_ADMIN_USERNAME);
      const newValid = await verifyUserPassword(updatedUser!, "new-password-123");
      expect(newValid).toBeTruthy();

      // Verify old password no longer works
      const oldValid = await verifyUserPassword(updatedUser!, TEST_ADMIN_PASSWORD);
      expect(oldValid).toBeNull();

      // Verify all sessions were invalidated
      const session1 = await getSession("session1");
      const session2 = await getSession("session2");
      expect(session1).toBeNull();
      expect(session2).toBeNull();
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

    test("recordFailedLogin locks after 5 attempts", async () => {
      for (let i = 0; i < 4; i++) {
        const locked = await recordFailedLogin("192.168.1.3");
        expect(locked).toBe(false);
      }

      // 5th attempt should lock
      const locked = await recordFailedLogin("192.168.1.3");
      expect(locked).toBe(true);
    });

    test("isLoginRateLimited returns true when locked", async () => {
      // Lock the IP
      for (let i = 0; i < 5; i++) {
        await recordFailedLogin("192.168.1.4");
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

      // Lock the IP
      for (let i = 0; i < 5; i++) {
        await recordFailedLogin(ip);
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
      const locked = await recordFailedLogin(ip);
      expect(locked).toBe(false);
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
});
