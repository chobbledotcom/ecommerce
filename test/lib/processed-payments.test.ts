import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import {
  deleteStaleReservation,
  isReservationStale,
  isSessionProcessed,
  reserveSession,
  STALE_RESERVATION_MS,
} from "#lib/db/processed-payments.ts";
import { getDb } from "#lib/db/client.ts";
import {
  createTestDbWithSetup,
  resetDb,
} from "#test-utils";

describe("processed-payments", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("isReservationStale", () => {
    test("returns false for recent timestamp", () => {
      const recent = new Date().toISOString();
      expect(isReservationStale(recent)).toBe(false);
    });

    test("returns false for timestamp just under threshold", () => {
      const justUnder = new Date(Date.now() - STALE_RESERVATION_MS + 1000).toISOString();
      expect(isReservationStale(justUnder)).toBe(false);
    });

    test("returns true for timestamp over threshold", () => {
      const stale = new Date(Date.now() - STALE_RESERVATION_MS - 1000).toISOString();
      expect(isReservationStale(stale)).toBe(true);
    });

    test("returns true for very old timestamp", () => {
      const veryOld = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      expect(isReservationStale(veryOld)).toBe(true);
    });
  });

  describe("deleteStaleReservation", () => {
    test("deletes existing reservation", async () => {
      await reserveSession("cs_stale_to_delete");

      // Verify it exists
      let record = await isSessionProcessed("cs_stale_to_delete");
      expect(record).not.toBeNull();

      // Delete it
      await deleteStaleReservation("cs_stale_to_delete");

      // Verify it's gone
      record = await isSessionProcessed("cs_stale_to_delete");
      expect(record).toBeNull();
    });

    test("does nothing for non-existent session", async () => {
      // Should not throw
      await deleteStaleReservation("cs_nonexistent");
    });
  });

  describe("stale reservation recovery", () => {
    test("reserveSession does not recover fresh unfinalized reservation", async () => {
      // Create a reservation that is NOT stale
      await reserveSession("cs_fresh_unfinalized");

      // Another request tries to reserve
      const result = await reserveSession("cs_fresh_unfinalized");

      // Should fail (reservation is fresh, still being processed)
      expect(result.reserved).toBe(false);
      if (!result.reserved) {
        expect(result.existing.payment_session_id).toBe("cs_fresh_unfinalized");
      }
    });

  });

  describe("reserveSession race condition recovery", () => {
    test("retries when record disappeared between UNIQUE error and SELECT", async () => {
      // Simulate the edge case: INSERT fails with UNIQUE constraint,
      // but the record was deleted between INSERT and SELECT.
      // This exercises the recursive reserveSession(sessionId) call on line 93.
      const sessionId = "cs_race_vanish";
      let callCount = 0;

      // First, manually insert the record
      await getDb().execute({
        sql: "INSERT INTO processed_payments (payment_session_id, processed_at) VALUES (?, ?)",
        args: [sessionId, new Date().toISOString()],
      });

      // Spy on getDb().execute so we can simulate the race:
      // On the first INSERT attempt after we set up the spy, it hits UNIQUE constraint.
      // On the isSessionProcessed call, it should return null (we delete the record).
      // Then the recursive call should succeed.
      const origExecute = getDb().execute.bind(getDb());

      // Delete the record right after it causes a UNIQUE error but before isSessionProcessed runs
      const executeSpy = spyOn(getDb(), "execute");
      executeSpy.mockImplementation(async (stmt: unknown) => {
        const sql = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;

        if (sql.includes("INSERT INTO processed_payments") && callCount === 0) {
          callCount++;
          // Delete the record to simulate the race condition
          await origExecute({
            sql: "DELETE FROM processed_payments WHERE payment_session_id = ?",
            args: [sessionId],
          });
          // Now throw UNIQUE constraint error (simulating the original INSERT that failed)
          throw new Error("UNIQUE constraint failed: processed_payments.payment_session_id");
        }

        // For all other calls, use the original
        return origExecute(stmt as Parameters<typeof origExecute>[0]);
      });

      try {
        const result = await reserveSession(sessionId);
        // After retry, should succeed
        expect(result.reserved).toBe(true);
      } finally {
        executeSpy.mockRestore();
      }
    });
  });

  describe("reserveSession conflict", () => {
    test("reserveSession returns conflict for already-claimed session", async () => {
      const result1 = await reserveSession("sess_123");
      expect(result1.reserved).toBe(true);

      const result2 = await reserveSession("sess_123");
      expect(result2.reserved).toBe(false);
      if (!result2.reserved) {
        expect(result2.existing.payment_session_id).toBe("sess_123");
      }
    });

    test("reserveSession reclaims stale reservation", async () => {
      // Insert a stale reservation
      const staleTime = new Date(Date.now() - STALE_RESERVATION_MS - 1000).toISOString();
      await getDb().execute({
        sql: "INSERT INTO processed_payments (payment_session_id, processed_at) VALUES (?, ?)",
        args: ["stale_sess", staleTime],
      });

      const result = await reserveSession("stale_sess");
      expect(result.reserved).toBe(true);
    });

    test("reserveSession rethrows non-constraint errors", async () => {
      // Drop the table to cause a different error
      await getDb().execute("DROP TABLE processed_payments");

      await expect(reserveSession("any_sess")).rejects.toThrow();

      // Recreate for cleanup
      await getDb().execute(`
        CREATE TABLE processed_payments (
          payment_session_id TEXT PRIMARY KEY,
          processed_at TEXT NOT NULL
        )
      `);
    });
  });
});
