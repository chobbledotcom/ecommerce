import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import { getAvailableStock } from "#lib/db/products.ts";
import {
  confirmReservation,
  expireReservation,
  expireStaleReservations,
  getReservationsBySession,
  reserveStock,
  restockFromRefund,
} from "#lib/db/reservations.ts";
import { createTestDb, createTestProduct, resetDb } from "#test-utils";

describe("reservations", () => {
  beforeEach(async () => {
    await createTestDb();
  });

  afterEach(() => {
    resetDb();
  });

  describe("reserveStock", () => {
    test("reserves stock when available", async () => {
      const product = await createTestProduct({ stock: 10 });
      const id = await reserveStock(product.id, 3, "session-1");

      expect(id).not.toBeNull();
      expect(typeof id).toBe("number");

      const reservations = await getReservationsBySession("session-1");
      expect(reservations).toHaveLength(1);
      expect(reservations[0]!.product_id).toBe(product.id);
      expect(reservations[0]!.quantity).toBe(3);
      expect(reservations[0]!.status).toBe("pending");
    });

    test("fails when insufficient stock", async () => {
      const product = await createTestProduct({ stock: 2 });
      const id = await reserveStock(product.id, 5, "session-1");

      expect(id).toBeNull();
    });

    test("fails when product does not exist", async () => {
      const id = await reserveStock(999, 1, "session-1");
      expect(id).toBeNull();
    });

    test("fails when product is inactive", async () => {
      const product = await createTestProduct({ stock: 10, active: 0 });
      const id = await reserveStock(product.id, 1, "session-1");
      expect(id).toBeNull();
    });

    test("accounts for existing reservations", async () => {
      const product = await createTestProduct({ stock: 5 });
      await reserveStock(product.id, 3, "session-1");

      // Only 2 remaining
      const id = await reserveStock(product.id, 3, "session-2");
      expect(id).toBeNull();

      // But 2 should work
      const id2 = await reserveStock(product.id, 2, "session-3");
      expect(id2).not.toBeNull();
    });

    test("succeeds for unlimited stock", async () => {
      const product = await createTestProduct({ stock: -1 });

      const id1 = await reserveStock(product.id, 1000, "session-1");
      expect(id1).not.toBeNull();

      const id2 = await reserveStock(product.id, 5000, "session-2");
      expect(id2).not.toBeNull();
    });

    test("does not count expired reservations against stock", async () => {
      const product = await createTestProduct({ stock: 5 });
      await reserveStock(product.id, 5, "session-1");
      await expireReservation("session-1");

      // Stock should be available again
      const id = await reserveStock(product.id, 5, "session-2");
      expect(id).not.toBeNull();
    });
  });

  describe("confirmReservation", () => {
    test("confirms pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "session-1");

      const count = await confirmReservation("session-1");
      expect(count).toBe(1);

      const reservations = await getReservationsBySession("session-1");
      expect(reservations[0]!.status).toBe("confirmed");
    });

    test("confirms multiple reservations for same session", async () => {
      const product1 = await createTestProduct({ sku: "P1", stock: 10 });
      const product2 = await createTestProduct({ sku: "P2", stock: 10 });
      await reserveStock(product1.id, 2, "multi-session");
      await reserveStock(product2.id, 1, "multi-session");

      const count = await confirmReservation("multi-session");
      expect(count).toBe(2);
    });

    test("returns 0 for unknown session", async () => {
      const count = await confirmReservation("nonexistent");
      expect(count).toBe(0);
    });

    test("does not re-confirm already confirmed reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "session-1");
      await confirmReservation("session-1");

      const count = await confirmReservation("session-1");
      expect(count).toBe(0);
    });
  });

  describe("expireReservation", () => {
    test("expires pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "session-1");

      const count = await expireReservation("session-1");
      expect(count).toBe(1);

      const reservations = await getReservationsBySession("session-1");
      expect(reservations[0]!.status).toBe("expired");
    });

    test("returns stock to available pool", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 5, "session-1");

      expect(await getAvailableStock(product.id)).toBe(5);

      await expireReservation("session-1");

      expect(await getAvailableStock(product.id)).toBe(10);
    });

    test("does not expire confirmed reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "session-1");
      await confirmReservation("session-1");

      const count = await expireReservation("session-1");
      expect(count).toBe(0);

      const reservations = await getReservationsBySession("session-1");
      expect(reservations[0]!.status).toBe("confirmed");
    });
  });

  describe("expireStaleReservations", () => {
    test("expires old pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "old-session");

      // Manually backdate the reservation
      const { getDb } = await import("#lib/db/client.ts");
      const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      await getDb().execute({
        sql: "UPDATE stock_reservations SET created = ? WHERE provider_session_id = ?",
        args: [oldDate, "old-session"],
      });

      const count = await expireStaleReservations(30 * 60 * 1000); // 30 minutes
      expect(count).toBe(1);
    });

    test("does not expire recent pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "recent-session");

      const count = await expireStaleReservations(30 * 60 * 1000);
      expect(count).toBe(0);
    });

    test("does not expire confirmed reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "confirmed-session");
      await confirmReservation("confirmed-session");

      // Backdate
      const { getDb } = await import("#lib/db/client.ts");
      const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await getDb().execute({
        sql: "UPDATE stock_reservations SET created = ? WHERE provider_session_id = ?",
        args: [oldDate, "confirmed-session"],
      });

      const count = await expireStaleReservations(30 * 60 * 1000);
      expect(count).toBe(0);
    });
  });

  describe("restockFromRefund", () => {
    test("sets confirmed reservations to expired", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 5, "refund-session");
      await confirmReservation("refund-session");

      expect(await getAvailableStock(product.id)).toBe(5);

      const count = await restockFromRefund("refund-session");
      expect(count).toBe(1);

      expect(await getAvailableStock(product.id)).toBe(10);
    });

    test("does not affect pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "pending-session");

      const count = await restockFromRefund("pending-session");
      expect(count).toBe(0);

      const reservations = await getReservationsBySession("pending-session");
      expect(reservations[0]!.status).toBe("pending");
    });

    test("is idempotent", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 5, "idem-session");
      await confirmReservation("idem-session");

      await restockFromRefund("idem-session");
      const count = await restockFromRefund("idem-session");
      expect(count).toBe(0);
    });
  });

  describe("getReservationsBySession", () => {
    test("returns all reservations for a session", async () => {
      const product1 = await createTestProduct({ sku: "RS-1", stock: 10 });
      const product2 = await createTestProduct({ sku: "RS-2", stock: 10 });
      await reserveStock(product1.id, 2, "multi");
      await reserveStock(product2.id, 1, "multi");

      const reservations = await getReservationsBySession("multi");
      expect(reservations).toHaveLength(2);
    });

    test("returns empty array for unknown session", async () => {
      const reservations = await getReservationsBySession("unknown");
      expect(reservations).toHaveLength(0);
    });
  });
});
