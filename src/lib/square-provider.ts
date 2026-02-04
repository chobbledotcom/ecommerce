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
import {
  toSessionListResult,
  type CheckoutSessionResult,
  type CreateCheckoutParams,
  type ListSessionsParams,
  type PaymentProvider,
  type PaymentProviderType,
  type PaymentSession,
  type PaymentSessionDetail,
  type PaymentSessionListResult,
  type WebhookEvent,
  type WebhookSetupResult,
  type WebhookVerifyResult,
} from "#lib/payments.ts";
import {
  createCheckoutSession,
  refundPayment,
  retrieveOrder,
  searchOrders,
  verifyWebhookSignature,
} from "#lib/square.ts";

/** Map a Square order to our PaymentSession type */
const toPaymentSession = (order: { id?: string; state?: string }): PaymentSession => ({
  id: order.id ?? "",
  status: order.state ?? "UNKNOWN",
  amount: null,
  currency: null,
  customerEmail: null,
  created: "",
  url: null,
});

/** Build a Square dashboard URL for an order */
const squareDashboardUrl = (orderId: string): string =>
  `https://squareup.com/dashboard/orders/overview/${orderId}`;

/** Square payment provider implementation */
export const squarePaymentProvider: PaymentProvider = {
  type: "square" as PaymentProviderType,

  checkoutCompletedEventType: "payment.updated",
  checkoutExpiredEventType: "order.updated", // Square notifies via order status change
  refundEventType: "refund.updated",

  getRefundReference(event: WebhookEvent): string | null {
    const obj = event.data.object as { payment_id?: string; id?: string };
    return obj.payment_id ?? obj.id ?? null;
  },

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

  createCheckoutSession: (params: CreateCheckoutParams): Promise<CheckoutSessionResult> =>
    createCheckoutSession(params),

  async retrieveSession(sessionId: string): Promise<PaymentSession | null> {
    const order = await retrieveOrder(sessionId);
    return order ? toPaymentSession(order) : null;
  },

  async retrieveSessionDetail(sessionId: string): Promise<PaymentSessionDetail | null> {
    const order = await retrieveOrder(sessionId);
    if (!order) return null;

    const base = toPaymentSession(order);
    const firstPaymentId = order.tenders?.[0]?.paymentId ?? null;

    return {
      ...base,
      lineItems: [],
      metadata: order.metadata ?? {},
      customerName: null,
      paymentReference: firstPaymentId,
      dashboardUrl: squareDashboardUrl(order.id ?? sessionId),
      providerType: "square",
    };
  },

  async listSessions(params: ListSessionsParams): Promise<PaymentSessionListResult> {
    const result = await searchOrders({
      limit: params.limit,
      cursor: params.startingAfter,
    });
    return toSessionListResult(result, result?.orders, toPaymentSession);
  },
};
