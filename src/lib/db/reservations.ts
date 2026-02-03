/**
 * Stock reservation operations
 *
 * Manages the lifecycle of stock reservations:
 * pending → confirmed (on successful payment)
 * pending → expired (on timeout or cancellation)
 * confirmed → expired (on refund, restocks)
 */

import { getDb } from "#lib/db/client.ts";
import { col, defineTable } from "#lib/db/table.ts";
import type { Reservation, ReservationStatus } from "#lib/types.ts";

/** Input type for creating a reservation (camelCase keys for table insert) */
export type ReservationInput = {
  productId: number;
  quantity: number;
  providerSessionId: string;
  status?: ReservationStatus;
  created?: string;
};

export const reservationsTable = defineTable<Reservation, ReservationInput>({
  name: "stock_reservations",
  primaryKey: "id",
  schema: {
    id: col.generated<number>(),
    product_id: col.simple<number>(),
    quantity: col.simple<number>(),
    provider_session_id: col.simple<string>(),
    status: col.withDefault<ReservationStatus>(() => "pending"),
    created: col.timestamp(),
  },
});

/**
 * Atomically reserve stock for a product.
 * Checks available stock (total - pending/confirmed reservations) and
 * only inserts a reservation if sufficient stock exists.
 *
 * For unlimited stock (stock = -1), always succeeds.
 *
 * Returns the reservation ID on success, null if insufficient stock.
 */
export const reserveStock = async (
  productId: number,
  quantity: number,
  providerSessionId: string,
): Promise<number | null> => {
  const now = new Date().toISOString();
  const result = await getDb().execute({
    sql: `INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
          SELECT ?, ?, ?, 'pending', ?
          WHERE (
            SELECT stock FROM products WHERE id = ? AND active = 1
          ) = -1
          OR (
            SELECT stock FROM products WHERE id = ? AND active = 1
          ) - COALESCE((
            SELECT SUM(quantity) FROM stock_reservations
            WHERE product_id = ? AND status IN ('pending', 'confirmed')
          ), 0) >= ?`,
    args: [
      productId,
      quantity,
      providerSessionId,
      now,
      productId,
      productId,
      productId,
      quantity,
    ],
  });

  if (result.rowsAffected === 0) return null;
  return Number(result.lastInsertRowid);
};

/** Transition reservations matching a WHERE clause to a new status. */
const transitionStatus = async (
  newStatus: ReservationStatus,
  whereClause: string,
  args: (string | number)[],
): Promise<number> => {
  const result = await getDb().execute({
    sql: `UPDATE stock_reservations SET status = '${newStatus}' WHERE ${whereClause}`,
    args,
  });
  return result.rowsAffected;
};

/**
 * Confirm reservations for a completed checkout session.
 * Updates all pending reservations with the given session ID to confirmed.
 * Returns the number of reservations confirmed.
 */
export const confirmReservation = (
  providerSessionId: string,
): Promise<number> =>
  transitionStatus("confirmed", "provider_session_id = ? AND status = 'pending'", [providerSessionId]);

/**
 * Expire reservations for a cancelled/expired checkout session.
 * Updates all pending reservations with the given session ID to expired.
 * Returns the number of reservations expired.
 */
export const expireReservation = (
  providerSessionId: string,
): Promise<number> =>
  transitionStatus("expired", "provider_session_id = ? AND status = 'pending'", [providerSessionId]);

/**
 * Expire stale pending reservations older than maxAgeMs milliseconds.
 * Returns the number of reservations expired.
 */
export const expireStaleReservations = (
  maxAgeMs: number,
): Promise<number> => {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  return transitionStatus("expired", "status = 'pending' AND created < ?", [cutoff]);
};

/**
 * Restock from a refund — set confirmed reservations back to expired.
 * This returns the reserved stock to the available pool.
 * Returns the number of reservations restocked.
 */
export const restockFromRefund = (
  providerSessionId: string,
): Promise<number> =>
  transitionStatus("expired", "provider_session_id = ? AND status = 'confirmed'", [providerSessionId]);

/**
 * Get all reservations for a provider session ID.
 */
export const getReservationsBySession = async (
  providerSessionId: string,
): Promise<Reservation[]> => {
  const result = await getDb().execute({
    sql: `SELECT * FROM stock_reservations WHERE provider_session_id = ?`,
    args: [providerSessionId],
  });
  return result.rows as unknown as Reservation[];
};
