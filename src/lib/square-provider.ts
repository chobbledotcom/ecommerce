/**
 * Square implementation of the PaymentProvider interface
 *
 * Wraps the square.ts module to conform to the
 * provider-agnostic PaymentProvider contract.
 *
 * Key differences from Stripe:
 * - Uses Payment Links instead of checkout sessions
 * - Order ID is the session equivalent
 * - Webhook event is payment.updated (not checkout.session.completed)
 * - Webhook setup is manual (user provides signature key from dashboard)
 */

import { getAllowedDomain } from "#lib/config.ts";
import { toSessionListResult } from "#lib/payment-helpers.ts";
import {
  refundPayment,
  searchOrders,
  verifyWebhookSignature,
} from "#lib/square.ts";
import type {
  ListSessionsParams,
  PaymentProvider,
  PaymentProviderType,
  PaymentSessionListResult,
  WebhookSetupResult,
  WebhookVerifyResult,
} from "#lib/payments.ts";

/** Square payment provider implementation */
export const squarePaymentProvider: PaymentProvider = {
  type: "square" as PaymentProviderType,

  checkoutCompletedEventType: "payment.updated",

  verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<WebhookVerifyResult> {
    const domain = getAllowedDomain();
    const notificationUrl = `https://${domain}/payment/webhook`;
    return verifyWebhookSignature(payload, signature, notificationUrl);
  },

  refundPayment(paymentReference: string): Promise<boolean> {
    return refundPayment(paymentReference);
  },

  setupWebhookEndpoint(
    _secretKey: string,
    _webhookUrl: string,
    _existingEndpointId?: string | null,
  ): Promise<WebhookSetupResult> {
    // Square webhook setup is manual - user creates subscription in dashboard
    // and provides the signature key. This method is a no-op for Square.
    return Promise.resolve({
      success: false as const,
      error: "Square webhooks must be configured manually in the Square Developer Dashboard",
    });
  },

  async listSessions(params: ListSessionsParams): Promise<PaymentSessionListResult> {
    const result = await searchOrders({
      limit: params.limit,
      cursor: params.startingAfter,
    });
    return toSessionListResult(result, result?.orders, (order) => ({
      id: order.id ?? "",
      status: order.state ?? "UNKNOWN",
      amount: null,
      currency: null,
      customerEmail: null,
      created: "",
      url: null,
    }));
  },
};
