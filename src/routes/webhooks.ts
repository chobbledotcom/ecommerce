/**
 * Webhook routes - payment callbacks and provider webhooks
 *
 * Payment flow (stock reservation based):
 * 1. POST /api/checkout reserves stock, creates provider checkout session
 * 2. Provider webhook fires on completion/expiry/refund
 * 3. Completion → confirm reservations
 * 4. Expiry → release reservations (return stock)
 * 5. Refund → release confirmed reservations (return stock)
 *
 * Security:
 * - Webhooks are verified using provider-specific signature verification
 * - Two-phase locking via processed_payments prevents duplicate processing
 */

import { map } from "#fp";
import { getCurrencyCode } from "#lib/config.ts";
import { getDb } from "#lib/db/client.ts";
import { reserveSession } from "#lib/db/processed-payments.ts";
import { confirmReservation, expireReservation, getReservationsBySession, restockFromRefund } from "#lib/db/reservations.ts";
import { getSetting } from "#lib/db/settings.ts";
import { logDebug } from "#lib/logger.ts";
import {
  getActivePaymentProvider,
} from "#lib/payments.ts";
import type { Product, Reservation } from "#lib/types.ts";
import { logAndNotifyOrder, type WebhookLineItem } from "#lib/webhook.ts";
import { createRouter, defineRoutes } from "#routes/router.ts";

/** JSON response acknowledging a webhook event without processing */
const webhookAckResponse = (extra?: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ received: true, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Detect which provider sent the webhook based on request headers */
const getWebhookSignatureHeader = (
  request: Request,
): string | null =>
  request.headers.get("stripe-signature") ??
  request.headers.get("x-square-hmacsha256-signature") ??
  null;

/** Build webhook line items from reservations and their products */
const buildLineItems = async (
  reservations: Reservation[],
): Promise<WebhookLineItem[]> => {
  const productIds = map((r: Reservation) => r.product_id)(reservations);
  if (productIds.length === 0) return [];

  const placeholders = productIds.map(() => "?").join(",");
  const result = await getDb().execute({
    sql: `SELECT * FROM products WHERE id IN (${placeholders})`,
    args: productIds,
  });
  const products = result.rows as unknown as Product[];
  const productMap = new Map(map((p: Product) => [p.id, p] as const)(products));

  return map((r: Reservation) => {
    const product = productMap.get(r.product_id);
    return {
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      unit_price: product?.unit_price ?? 0,
      quantity: r.quantity,
    };
  })(reservations);
};

/** Extract the provider session ID from the webhook event */
const getSessionId = (event: { data: { object: Record<string, unknown> } }): string | null => {
  const obj = event.data.object;
  // Square: payment.updated → object.order_id is the order ID (reservations stored under order ID)
  // Stripe: checkout.session.completed → object.id is the session ID (no order_id field)
  return (obj.order_id as string) ?? (obj.id as string) ?? null;
};

/**
 * Handle POST /payment/webhook (payment provider webhook endpoint)
 *
 * Receives events directly from the payment provider with signature verification.
 * Handles checkout completion, expiry, and refunds for stock reservation management.
 */
const handlePaymentWebhook = async (request: Request): Promise<Response> => {
  const provider = await getActivePaymentProvider();
  if (!provider) return new Response("Payment provider not configured", { status: 400 });

  // Get signature header
  const signature = getWebhookSignatureHeader(request);
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  // Read raw body for signature verification
  const payload = await request.text();

  // Verify signature
  const verification = await provider.verifyWebhookSignature(payload, signature);
  if (!verification.valid) {
    return new Response(verification.error, { status: 400 });
  }

  const event = verification.event;

  // Handle checkout completed
  if (event.type === provider.checkoutCompletedEventType) {
    const sessionId = getSessionId(event);
    if (!sessionId) return webhookAckResponse();

    // Idempotency: claim this session ID
    const reservation = await reserveSession(sessionId);
    if (!reservation.reserved) {
      logDebug("Webhook", `Session already processed: ${sessionId}`);
      return webhookAckResponse({ already_processed: true });
    }

    // Confirm stock reservations
    const confirmed = await confirmReservation(sessionId);
    logDebug("Webhook", `Confirmed ${confirmed} reservations for ${sessionId}`);

    // Send webhook notification
    const reservations = await getReservationsBySession(sessionId);
    const lineItems = await buildLineItems(reservations);
    const currency = await getCurrencyCode();
    const webhookUrl = await getSetting("webhook_url");
    await logAndNotifyOrder(sessionId, lineItems, currency, webhookUrl);

    return webhookAckResponse({ processed: true, confirmed });
  }

  // Handle checkout expired
  if (provider.checkoutExpiredEventType && event.type === provider.checkoutExpiredEventType) {
    const sessionId = getSessionId(event);
    if (!sessionId) return webhookAckResponse();

    const expired = await expireReservation(sessionId);
    logDebug("Webhook", `Expired ${expired} reservations for ${sessionId}`);
    return webhookAckResponse({ processed: true, expired });
  }

  // Handle refund
  if (provider.refundEventType && event.type === provider.refundEventType) {
    const refundReference = await provider.getRefundReference(event);
    if (!refundReference) return webhookAckResponse();

    const restocked = await restockFromRefund(refundReference);
    logDebug("Webhook", `Restocked ${restocked} reservations for refund ${refundReference}`);
    return webhookAckResponse({ processed: true, restocked });
  }

  // Acknowledge other events without processing
  return webhookAckResponse();
};

/** Payment routes definition */
const paymentRoutes = defineRoutes({
  "POST /payment/webhook": (request) => handlePaymentWebhook(request),
});

/**
 * Route payment requests
 */
export const routePayment = createRouter(paymentRoutes);
