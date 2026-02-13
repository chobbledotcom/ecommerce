/**
 * Stock reservation operations
 *
 * Manages the lifecycle of stock reservations:
 * pending → confirmed (on successful payment)
 * pending → expired (on timeout or cancellation)
 * confirmed → expired (on refund, restocks)
 */

import { getDb, queryRows } from "#lib/db/client.ts";
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

/** Transition reservations by provider session ID from one status to another. */
const transitionBySession = async (
  newStatus: ReservationStatus,
  requiredStatus: ReservationStatus,
  providerSessionId: string,
): Promise<number> => {
  const result = await getDb().execute({
    sql: `UPDATE stock_reservations SET status = ? WHERE provider_session_id = ? AND status = ?`,
    args: [newStatus, providerSessionId, requiredStatus],
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
  transitionBySession("confirmed", "pending", providerSessionId);

/**
 * Expire reservations for a cancelled/expired checkout session.
 * Updates all pending reservations with the given session ID to expired.
 * Returns the number of reservations expired.
 */
export const expireReservation = (
  providerSessionId: string,
): Promise<number> =>
  transitionBySession("expired", "pending", providerSessionId);

/**
 * Expire stale pending reservations older than maxAgeMs milliseconds.
 * Returns the number of reservations expired.
 */
export const expireStaleReservations = async (
  maxAgeMs: number,
): Promise<number> => {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = await getDb().execute({
    sql: `UPDATE stock_reservations SET status = ? WHERE status = ? AND created < ?`,
    args: ["expired", "pending", cutoff],
  });
  return result.rowsAffected;
};

/**
 * Restock from a refund — set confirmed reservations back to expired.
 * This returns the reserved stock to the available pool.
 * Returns the number of reservations restocked.
 */
export const restockFromRefund = (
  providerSessionId: string,
): Promise<number> =>
  transitionBySession("expired", "confirmed", providerSessionId);

/** How long a pending reservation can sit before being considered stale */
const STALE_RESERVATION_MS = 30 * 60 * 1000; // 30 minutes

/** Item to reserve in a batch checkout */
export type ReservationItem = {
  productId: number;
  quantity: number;
};

/**
 * Reserve stock for multiple items in a single atomic write batch.
 * Uses batch("write") so no concurrent writes can interleave between
 * the stock availability checks and the inserts.
 * Expires stale reservations first to reclaim abandoned stock.
 *
 * If any item has insufficient stock, successfully reserved items are
 * expired and the first failing SKU is returned.
 */
export const reserveStockBatch = async (
  items: ReservationItem[],
  skuByProductId: Map<number, string>,
  providerSessionId: string,
): Promise<{ ok: true; reservationIds: number[] } | { ok: false; failedSku: string }> => {
  const cutoff = new Date(Date.now() - STALE_RESERVATION_MS).toISOString();
  const now = new Date().toISOString();

  const reserveInsert = (item: ReservationItem) => ({
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
      item.productId,
      item.quantity,
      providerSessionId,
      now,
      item.productId,
      item.productId,
      item.productId,
      item.quantity,
    ],
  });

  // Atomic batch: expire stale reservations then insert all new ones
  const results = await getDb().batch(
    [
      {
        sql: `UPDATE stock_reservations SET status = ? WHERE status = ? AND created < ?`,
        args: ["expired", "pending", cutoff],
      },
      ...items.map(reserveInsert),
    ],
    "write",
  );

  // results[0] is the stale expiry; results[1..] are the inserts
  const insertResults = results.slice(1);
  const reservationIds: number[] = [];
  let failedIndex = -1;

  for (let i = 0; i < insertResults.length; i++) {
    const result = insertResults[i]!;
    if (result.rowsAffected === 0) {
      failedIndex = i;
      break;
    }
    reservationIds.push(Number(result.lastInsertRowid));
  }

  if (failedIndex !== -1) {
    // Clean up any reservations that did succeed in this batch
    if (reservationIds.length > 0) {
      await expireReservation(providerSessionId);
    }
    const failedProductId = items[failedIndex]!.productId;
    return { ok: false, failedSku: skuByProductId.get(failedProductId) ?? "" };
  }

  return { ok: true, reservationIds };
};

/**
 * Update the provider session ID on reservations (e.g. after provider session creation).
 * Runs as a simple execute since atomicity with the reservation is not required.
 */
export const updateReservationSessionId = async (
  oldSessionId: string,
  newSessionId: string,
): Promise<void> => {
  await getDb().execute({
    sql: "UPDATE stock_reservations SET provider_session_id = ? WHERE provider_session_id = ?",
    args: [newSessionId, oldSessionId],
  });
};

/**
 * Get all reservations for a provider session ID.
 */
export const getReservationsBySession = (
  providerSessionId: string,
): Promise<Reservation[]> =>
  queryRows<Reservation>(
    `SELECT * FROM stock_reservations WHERE provider_session_id = ?`,
    [providerSessionId],
  );
