/**
 * Square API wrapper module
 * Uses lazy loading to avoid importing the Square SDK at startup
 *
 * Square flow differs from Stripe:
 * - Webhook event is payment.updated (check status === "COMPLETED")
 * - Webhook signature uses HMAC-SHA256 of notification_url + body
 */

import { lazyRef, once } from "#fp";
import {
  getSquareAccessToken,
  getSquareLocationId,
  getSquareWebhookSignatureKey,
} from "#lib/config.ts";
import { ErrorCode, logDebug, logError } from "#lib/logger.ts";
import {
  createWithClient,
} from "#lib/payment-helpers.ts";

import { computeHmacSha256, hmacToBase64, secureCompare } from "#lib/payment-crypto.ts";
import type {
  CheckoutSessionResult,
  CreateCheckoutParams,
  WebhookEvent,
  WebhookVerifyResult,
} from "#lib/payments.ts";

/** Lazy-load Square SDK only when needed */
const loadSquare = once(async () => {
  const { SquareClient } = await import("square");
  return SquareClient;
});

type SquareCache = { accessToken: string };

const [getCache, setCache] = lazyRef<SquareCache>(() => {
  throw new Error("Square cache not initialized");
});

/** Create a Square client instance */
const createSquareClient = async (accessToken: string) => {
  const SquareClient = await loadSquare();
  return new SquareClient({ token: accessToken });
};

/** Internal getSquareClient implementation */
const getClientImpl = async () => {
  const accessToken = await getSquareAccessToken();
  if (!accessToken) {
    logDebug("Square", "No access token configured, cannot create client");
    return null;
  }

  try {
    const cached = getCache();
    if (cached.accessToken === accessToken) {
      logDebug("Square", "Using cached Square client");
      return createSquareClient(accessToken);
    }
  } catch {
    // Cache not initialized
  }

  logDebug("Square", "Creating new Square client");
  setCache({ accessToken });
  return createSquareClient(accessToken);
};

/** Run operation with Square client, return null if not available */
const withClient = createWithClient(() => squareApi.getSquareClient());

/** Get the configured location ID */
const getLocationId = async (): Promise<string | null> => {
  const locationId = await getSquareLocationId();
  if (!locationId) {
    logDebug("Square", "No location ID configured");
    return null;
  }
  return locationId;
};

/** Square order response shape (subset we use) */
type SquareOrder = {
  id?: string;
  metadata?: Record<string, string>;
  tenders?: Array<{
    id?: string;
    paymentId?: string;
  }>;
  state?: string;
};

/** Square payment response shape (subset we use) */
type SquarePayment = {
  id?: string;
  status?: string;
  orderId?: string;
  amountMoney?: {
    amount?: bigint;
    currency?: string;
  };
};

/**
 * Stubbable API for testing - allows mocking in ES modules
 */
/** Result of searching orders */
export type SquareOrderListResult = {
  orders: SquareOrder[];
  hasMore: boolean;
  cursor?: string;
};

// deno-lint-ignore no-explicit-any
const toSquareOrder = (order: any): SquareOrder => {
  const metadata: Record<string, string> | undefined = order.metadata
    ? Object.fromEntries(
        Object.entries(order.metadata).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string",
        ),
      )
    : undefined;

  return {
    id: order.id,
    metadata,
    tenders: order.tenders?.map((t: { id?: string; paymentId?: string | null }) => ({
      id: t.id,
      paymentId: t.paymentId ?? undefined,
    })),
    state: order.state,
  };
};

export const squareApi: {
  getSquareClient: () => ReturnType<typeof getClientImpl>;
  resetSquareClient: () => void;
  createCheckoutSession: (params: CreateCheckoutParams) => Promise<CheckoutSessionResult>;
  retrieveOrder: (orderId: string) => Promise<SquareOrder | null>;
  searchOrders: (params: { limit: number; cursor?: string }) => Promise<SquareOrderListResult | null>;
  retrievePayment: (paymentId: string) => Promise<SquarePayment | null>;
  refundPayment: (paymentId: string) => Promise<boolean>;
} = {
  getSquareClient: getClientImpl,

  resetSquareClient: (): void => setCache(null),

  /** Create a checkout session via Square Payment Link */
  createCheckoutSession: (
    params: CreateCheckoutParams,
  ): Promise<CheckoutSessionResult> =>
    withClient(
      async (client) => {
        const locationId = await getLocationId();
        if (!locationId) return null;

        const response = await client.checkout.paymentLinks.create({
          order: {
            locationId,
            lineItems: params.lineItems.map((item) => ({
              name: item.name,
              quantity: String(item.quantity),
              basePriceMoney: {
                amount: BigInt(item.unitPrice),
                currency: params.currency as import("square").Square.Currency,
              },
            })),
            metadata: params.metadata,
          },
          checkoutOptions: {
            redirectUrl: params.successUrl,
          },
        });

        const link = response.paymentLink;
        if (!link?.url || !link.orderId) return null;
        return { sessionId: link.orderId, checkoutUrl: link.url };
      },
      ErrorCode.SQUARE_CHECKOUT,
    ),

  /** Retrieve an order by ID */
  retrieveOrder: (orderId: string): Promise<SquareOrder | null> =>
    withClient(
      async (client) => {
        const response = await client.orders.get({ orderId });
        return response.order ? toSquareOrder(response.order) : null;
      },
      ErrorCode.SQUARE_ORDER,
    ),

  /** Search orders (for listing in admin) */
  searchOrders: (
    params: { limit: number; cursor?: string },
  ): Promise<SquareOrderListResult | null> =>
    withClient(
      async (client) => {
        const locationId = await getLocationId();
        if (!locationId) return { orders: [], hasMore: false };

        const response = await client.orders.search({
          locationIds: [locationId],
          limit: params.limit,
          ...(params.cursor ? { cursor: params.cursor } : {}),
          query: {
            sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
          },
        });

        const orders: SquareOrder[] = (response.orders ?? []).map(toSquareOrder);

        return {
          orders,
          hasMore: !!response.cursor,
          cursor: response.cursor ?? undefined,
        };
      },
      ErrorCode.SQUARE_ORDER,
    ),

  /** Retrieve a payment by ID */
  retrievePayment: (paymentId: string): Promise<SquarePayment | null> =>
    withClient(
      async (client) => {
        const response = await client.payments.get({ paymentId });
        const payment = response.payment;
        if (!payment) return null;
        return {
          id: payment.id,
          status: payment.status,
          orderId: payment.orderId,
          amountMoney: {
            amount: payment.amountMoney?.amount as bigint | undefined,
            currency: payment.amountMoney?.currency as string | undefined,
          },
        };
      },
      ErrorCode.SQUARE_SESSION,
    ),

  /** Refund a payment (full amount) */
  refundPayment: async (paymentId: string): Promise<boolean> => {
    const payment = await squareApi.retrievePayment(paymentId);
    if (!payment?.amountMoney?.amount || !payment.amountMoney.currency) {
      logError({
        code: ErrorCode.SQUARE_REFUND,
        detail: `Cannot refund payment ${paymentId}: missing amount info`,
      });
      return false;
    }

    const result = await withClient(
      async (client) => {
        await client.refunds.refundPayment({
          idempotencyKey: crypto.randomUUID(),
          paymentId,
          amountMoney: {
            amount: payment.amountMoney!.amount,
            currency: payment.amountMoney!.currency as import("square").Square.Currency,
          },
        });
        return true;
      },
      ErrorCode.SQUARE_REFUND,
    );

    return result ?? false;
  },
};

// Wrapper exports for production code (delegate to squareApi for test mocking)
export const getSquareClient = () => squareApi.getSquareClient();
export const resetSquareClient = () => squareApi.resetSquareClient();
export const createCheckoutSession = (params: CreateCheckoutParams) =>
  squareApi.createCheckoutSession(params);
export const retrieveOrder = (orderId: string) =>
  squareApi.retrieveOrder(orderId);
export const searchOrders = (params: { limit: number; cursor?: string }) =>
  squareApi.searchOrders(params);
export const retrievePayment = (id: string) => squareApi.retrievePayment(id);
export const refundPayment = (id: string) => squareApi.refundPayment(id);

/**
 * =============================================================================
 * Webhook Signature Verification (Web Crypto API for Edge compatibility)
 * =============================================================================
 * Square webhook signature: HMAC-SHA256 of (notification_url + raw_body)
 * using the subscription's signature key. Result is base64-encoded.
 */

/** Compute HMAC-SHA256 and return base64-encoded result (Square format) */
const computeSquareSignature = async (
  data: string,
  secret: string,
): Promise<string> => hmacToBase64(await computeHmacSha256(data, secret));

/**
 * Verify Square webhook signature using Web Crypto API.
 * Square signs: HMAC-SHA256(signature_key, notification_url + raw_body)
 *
 * @param payload - Raw request body as string
 * @param signature - x-square-hmacsha256-signature header value
 * @param notificationUrl - The webhook notification URL registered with Square
 */
export const verifyWebhookSignature = async (
  payload: string,
  signature: string,
  notificationUrl?: string,
): Promise<WebhookVerifyResult> => {
  const secret = await getSquareWebhookSignatureKey();
  if (!secret) {
    logError({ code: ErrorCode.CONFIG_MISSING, detail: "Square webhook signature key" });
    return { valid: false, error: "Webhook signature key not configured" };
  }

  if (!notificationUrl) {
    logError({ code: ErrorCode.SQUARE_SIGNATURE, detail: "notification URL required" });
    return { valid: false, error: "Notification URL required for verification" };
  }

  // Square signs: notification_url + raw_body
  const signedPayload = notificationUrl + payload;
  const expectedSignature = await computeSquareSignature(signedPayload, secret);

  if (!secureCompare(signature, expectedSignature)) {
    logError({ code: ErrorCode.SQUARE_SIGNATURE, detail: "mismatch" });
    return { valid: false, error: "Signature verification failed" };
  }

  try {
    const event = JSON.parse(payload) as WebhookEvent;
    return { valid: true, event };
  } catch {
    logError({ code: ErrorCode.SQUARE_SIGNATURE, detail: "invalid JSON" });
    return { valid: false, error: "Invalid JSON payload" };
  }
};

/**
 * Construct a test webhook event (for testing purposes).
 * Generates a valid Square signature for the given payload.
 * Square signs: notification_url + raw_body (base64-encoded HMAC-SHA256).
 */
export const constructTestWebhookEvent = async (
  event: WebhookEvent,
  secret: string,
  notificationUrl: string,
): Promise<{ payload: string; signature: string }> => {
  const body = JSON.stringify(event);
  const signature = await computeSquareSignature(notificationUrl + body, secret);
  return { payload: body, signature };
};
