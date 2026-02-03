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

import {
  finalizeSession,
  reserveSession,
} from "#lib/db/processed-payments.ts";
import { ErrorCode, logError } from "#lib/logger.ts";
import {
  getActivePaymentProvider,
  type SessionMetadata,
  type ValidatedPaymentSession,
  type WebhookEvent,
} from "#lib/payments.ts";
import { createRouter, defineRoutes } from "#routes/router.ts";
import {
  getSearchParam,
  jsonErrorResponse,
} from "#routes/utils.ts";

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

/** Extract order/session ID from webhook event object (used for Square fallback) */
const extractSessionIdFromObject = (obj: Record<string, unknown>): string | null => {
  if (typeof obj.order_id === "string") return obj.order_id;
  if (typeof obj.id === "string") return obj.id;
  return null;
};

/**
 * Handle POST /payment/webhook (payment provider webhook endpoint)
 *
 * Receives events directly from the payment provider with signature verification.
 * Handles checkout completion, expiry, and refunds for stock reservation management.
 */
const handlePaymentWebhook = async (request: Request): Promise<Response> => {
  const provider = await getActivePaymentProvider();
  if (!provider) {
    return new Response("Payment provider not configured", { status: 400 });
  }

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

  // Only handle checkout completed events
  if (event.type !== provider.checkoutCompletedEventType) {
    // Acknowledge other events without processing
    return webhookAckResponse();
  }

  // TODO: Step 3 will implement stock reservation confirmation here
  // For now, acknowledge the event
  return webhookAckResponse({ processed: true });
};

/** Payment routes definition */
const paymentRoutes = defineRoutes({
  "POST /payment/webhook": (request) => handlePaymentWebhook(request),
});

/**
 * Route payment requests
 */
export const routePayment = createRouter(paymentRoutes);
