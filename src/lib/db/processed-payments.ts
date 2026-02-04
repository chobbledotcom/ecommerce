/**
 * Processed payments table operations (idempotency for webhook handling)
 *
 * Prevents duplicate processing of the same payment session webhook:
 * 1. reserveSession() - Claims the session ID
 * 2. Process the webhook (confirm/expire reservations)
 *
 * If reserveSession fails (already claimed), we check staleness:
 * - Stale (>5min old) → delete and retry (process likely crashed)
 * - Fresh → return conflict (still being processed)
 */

import { getDb, queryOne } from "#lib/db/client.ts";

/** Threshold for considering an unfinalized reservation abandoned (5 minutes) */
export const STALE_RESERVATION_MS = 5 * 60 * 1000;

/** Processed payment record */
export type ProcessedPayment = {
  payment_session_id: string;
  processed_at: string;
};

/** Result of session reservation attempt */
export type ReserveSessionResult =
  | { reserved: true }
  | { reserved: false; existing: ProcessedPayment };

/**
 * Check if a payment session has already been processed
 */
export const isSessionProcessed = (
  sessionId: string,
): Promise<ProcessedPayment | null> =>
  queryOne<ProcessedPayment>(
    "SELECT payment_session_id, processed_at FROM processed_payments WHERE payment_session_id = ?",
    [sessionId],
  );

/**
 * Check if a reservation is stale (abandoned by a crashed process)
 */
export const isReservationStale = (processedAt: string): boolean => {
  const reservedAt = new Date(processedAt).getTime();
  return Date.now() - reservedAt > STALE_RESERVATION_MS;
};

/**
 * Delete a stale reservation to allow retry
 */
export const deleteStaleReservation = async (
  sessionId: string,
): Promise<void> => {
  await getDb().execute({
    sql: "DELETE FROM processed_payments WHERE payment_session_id = ?",
    args: [sessionId],
  });
};

/**
 * Reserve a payment session for processing (idempotency lock).
 * Returns { reserved: true } if we claimed it, or { reserved: false, existing } if already claimed.
 *
 * Handles abandoned reservations: if an existing reservation is older than
 * STALE_RESERVATION_MS, we assume the process crashed and delete the stale
 * record to allow retry.
 */
export const reserveSession = async (
  sessionId: string,
): Promise<ReserveSessionResult> => {
  try {
    await getDb().execute({
      sql: "INSERT INTO processed_payments (payment_session_id, processed_at) VALUES (?, ?)",
      args: [sessionId, new Date().toISOString()],
    });
    return { reserved: true };
  } catch (e) {
    const errorMsg = String(e);
    if (
      errorMsg.includes("UNIQUE constraint") ||
      errorMsg.includes("PRIMARY KEY constraint")
    ) {
      // Session already claimed - get existing record
      const existing = await isSessionProcessed(sessionId);
      if (!existing) {
        // Race condition edge case: record existed but was deleted
        return reserveSession(sessionId);
      }

      // Check if reservation is stale (abandoned by crashed process)
      if (isReservationStale(existing.processed_at)) {
        await deleteStaleReservation(sessionId);
        return reserveSession(sessionId);
      }

      return { reserved: false, existing };
    }
    throw e;
  }
};
