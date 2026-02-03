/**
 * Stripe implementation of the PaymentProvider interface
 *
 * Wraps the existing stripe.ts module to conform to the
 * provider-agnostic PaymentProvider contract.
 */

import { toSessionListResult } from "#lib/payment-helpers.ts";
import type {
  ListSessionsParams,
  PaymentProvider,
  PaymentProviderType,
  PaymentSessionListResult,
  WebhookEvent,
  WebhookSetupResult,
  WebhookVerifyResult,
} from "#lib/payments.ts";
import {
  listCheckoutSessions,
  refundPayment as stripeRefund,
  setupWebhookEndpoint,
  verifyWebhookSignature,
} from "#lib/stripe.ts";

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

  async listSessions(params: ListSessionsParams): Promise<PaymentSessionListResult> {
    const result = await listCheckoutSessions(params);
    return toSessionListResult(result, result?.sessions, (s) => ({
      id: s.id,
      status: s.payment_status,
      amount: s.amount_total ?? null,
      currency: s.currency ?? null,
      customerEmail: s.customer_details?.email ?? s.customer_email ?? null,
      created: new Date(s.created * 1000).toISOString(),
      url: s.url ?? null,
    }));
  },
};
