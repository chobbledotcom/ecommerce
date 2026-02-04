/**
 * Stripe implementation of the PaymentProvider interface
 *
 * Wraps the existing stripe.ts module to conform to the
 * provider-agnostic PaymentProvider contract.
 */

import { toSessionListResult } from "#lib/payment-helpers.ts";
import type {
  CheckoutSessionResult,
  CreateCheckoutParams,
  ListSessionsParams,
  PaymentProvider,
  PaymentProviderType,
  PaymentSessionListResult,
  WebhookEvent,
  WebhookSetupResult,
  WebhookVerifyResult,
} from "#lib/payments.ts";
import type { PaymentSession } from "#lib/types.ts";
import {
  createCheckoutSession,
  listCheckoutSessions,
  refundPayment as stripeRefund,
  retrieveCheckoutSession,
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
}): PaymentSession => ({
  id: s.id,
  status: s.payment_status,
  amount: s.amount_total ?? null,
  currency: s.currency ?? null,
  customerEmail: s.customer_details?.email ?? s.customer_email ?? null,
  created: new Date(s.created * 1000).toISOString(),
  url: s.url ?? null,
});

/** Stripe payment provider implementation */
export const stripePaymentProvider: PaymentProvider = {
  type: "stripe" as PaymentProviderType,

  checkoutCompletedEventType: "checkout.session.completed",

  async verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<WebhookVerifyResult> {
    const result = await verifyWebhookSignature(payload, signature);
    if (!result.valid) {
      return { valid: false, error: result.error };
    }
    return {
      valid: true,
      event: result.event as WebhookEvent,
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
  ): Promise<WebhookSetupResult> {
    return setupWebhookEndpoint(secretKey, webhookUrl, existingEndpointId);
  },

  createCheckoutSession(
    params: CreateCheckoutParams,
  ): Promise<CheckoutSessionResult> {
    return createCheckoutSession(params);
  },

  async retrieveSession(sessionId: string): Promise<PaymentSession | null> {
    const session = await retrieveCheckoutSession(sessionId);
    return session ? toPaymentSession(session) : null;
  },

  async listSessions(params: ListSessionsParams): Promise<PaymentSessionListResult> {
    const result = await listCheckoutSessions(params);
    return toSessionListResult(result, result?.sessions, toPaymentSession);
  },
};
