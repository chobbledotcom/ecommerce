/**
 * Stripe implementation of the PaymentProvider interface
 *
 * Wraps the existing stripe.ts module to conform to the
 * provider-agnostic PaymentProvider contract.
 */

import { map } from "#fp";
import * as P from "#lib/payments.ts";
import type { PaymentLineItem, PaymentSessionDetail } from "#lib/types.ts";
import {
  createCheckoutSession,
  listCheckoutSessions,
  refundPayment as stripeRefund,
  retrieveCheckoutSession,
  retrieveCheckoutSessionExpanded,
  setupWebhookEndpoint,
  verifyWebhookSignature,
} from "#lib/stripe.ts";

/** Map a Stripe checkout session to our PaymentSession type */
const toPaymentSession = (s: {
  id: string;
  payment_status: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  created: number;
  url?: string | null;
}): P.PaymentSession => ({
  id: s.id,
  status: s.payment_status,
  amount: s.amount_total ?? null,
  currency: s.currency ?? null,
  customerEmail: s.customer_details?.email ?? s.customer_email ?? null,
  created: new Date(s.created * 1000).toISOString(),
  url: s.url ?? null,
});

/** Build a Stripe dashboard URL for a checkout session */
const stripeDashboardUrl = (sessionId: string): string =>
  `https://dashboard.stripe.com/checkout/sessions/${sessionId}`;

/** Stripe line item shape (subset we map from) */
type StripeLineItem = {
  description?: string | null;
  quantity?: number | null;
  price?: { unit_amount?: number | null } | null;
  amount_total?: number | null;
};

/** Map Stripe line items to our PaymentLineItem type */
const toLineItems = (
  lineItems: { data?: StripeLineItem[] } | null | undefined,
): PaymentLineItem[] => {
  if (!lineItems?.data) return [];
  return map((item: StripeLineItem): PaymentLineItem => ({
    name: item.description ?? "Unknown item",
    quantity: item.quantity ?? 1,
    unitPrice: item.price?.unit_amount ?? null,
    total: item.amount_total ?? null,
  }))(lineItems.data);
};

/** Extract metadata from a Stripe session as a plain string record */
const toMetadata = (metadata: Record<string, string> | null | undefined): Record<string, string> =>
  metadata ?? {};

/** Stripe payment provider implementation */
export const stripePaymentProvider: P.PaymentProvider = {
  type: "stripe" as P.PaymentProviderType,

  checkoutCompletedEventType: "checkout.session.completed",
  checkoutExpiredEventType: "checkout.session.expired",
  refundEventType: "charge.refunded",

  getRefundReference(event: P.WebhookEvent): string | null {
    const obj = event.data.object as { payment_intent?: string };
    return obj.payment_intent ?? null;
  },

  async verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<P.WebhookVerifyResult> {
    const result = await verifyWebhookSignature(payload, signature);
    if (!result.valid) {
      return { valid: false, error: result.error };
    }
    return {
      valid: true,
      event: result.event as P.WebhookEvent,
    };
  },

  async refundPayment(paymentReference: string): Promise<boolean> {
    const result = await stripeRefund(paymentReference);
    return result !== null;
  },

  setupWebhookEndpoint(
    secretKey: string,
    webhookUrl: string,
    existingEndpointId?: string | null,
  ): Promise<P.WebhookSetupResult> {
    return setupWebhookEndpoint(secretKey, webhookUrl, existingEndpointId);
  },

  createCheckoutSession(
    params: P.CreateCheckoutParams,
  ): Promise<P.CheckoutSessionResult> {
    return createCheckoutSession(params);
  },

  async retrieveSession(sessionId: string): Promise<P.PaymentSession | null> {
    const session = await retrieveCheckoutSession(sessionId);
    return session ? toPaymentSession(session) : null;
  },

  async retrieveSessionDetail(sessionId: string): Promise<PaymentSessionDetail | null> {
    const session = await retrieveCheckoutSessionExpanded(sessionId);
    if (!session) return null;

    const base = toPaymentSession(session);
    // deno-lint-ignore no-explicit-any
    const lineItemsObj = (session as any).line_items;
    const paymentIntent = typeof session.payment_intent === "string"
      ? session.payment_intent
      : null;

    return {
      ...base,
      lineItems: toLineItems(lineItemsObj),
      metadata: toMetadata(session.metadata),
      customerName: session.customer_details?.name ?? null,
      paymentReference: paymentIntent,
      dashboardUrl: stripeDashboardUrl(session.id),
      providerType: "stripe",
    };
  },

  async listSessions(params: P.ListSessionsParams): Promise<P.PaymentSessionListResult> {
    const result = await listCheckoutSessions(params);
    return P.toSessionListResult(result, result?.sessions, toPaymentSession);
  },
};
