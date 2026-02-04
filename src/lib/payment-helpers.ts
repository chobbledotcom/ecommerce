/**
 * Shared helpers for payment provider implementations.
 * Eliminates duplication between stripe.ts/square.ts and their provider adapters.
 */

import type { ErrorCodeType } from "#lib/logger.ts";
import { logError } from "#lib/logger.ts";
import type { PaymentSessionListResult } from "#lib/payments.ts";
import type { PaymentSession } from "#lib/types.ts";

/** Safely execute async operation, returning null on error */
export const safeAsync = async <T>(
  fn: () => Promise<T>,
  errorCode: ErrorCodeType,
): Promise<T | null> => {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    logError({ code: errorCode, detail });
    return null;
  }
};

/**
 * Create a withClient helper that runs an operation with a lazily-resolved client.
 * Returns null if the client is not available or the operation fails.
 */
export const createWithClient = <Client>(
  getClient: () => Promise<Client | null>,
) =>
  async <T>(
    op: (client: Client) => Promise<T>,
    errorCode: ErrorCodeType,
  ): Promise<T | null> => {
    const client = await getClient();
    return client ? safeAsync(() => op(client), errorCode) : null;
  };

/**
 * Build a PaymentSessionListResult from a nullable provider result.
 * Handles the common null-check and mapping pattern for both providers.
 */
export const toSessionListResult = <T>(
  result: { hasMore: boolean } & Record<string, unknown> | null,
  items: T[] | undefined,
  mapFn: (item: T) => PaymentSession,
): PaymentSessionListResult => {
  if (!result || !items) return { sessions: [], hasMore: false };
  return { sessions: items.map(mapFn), hasMore: result.hasMore };
};
