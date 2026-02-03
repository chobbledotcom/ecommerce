/**
 * Payment provider abstraction layer
 *
 * Defines a provider-agnostic interface for payment operations.
 * Admins choose a provider (e.g. Stripe) in settings; routes use
 * this interface so they never depend on a specific provider.
 */

import { getPaymentProvider as getConfiguredProvider } from "#lib/config.ts";
import { logDebug } from "#lib/logger.ts";
import type { PaymentSession } from "#lib/types.ts";

/** Stubbable API for internal calls (testable via spyOn, like stripeApi/squareApi) */
export const paymentsApi = {
  getConfiguredProvider,
};

/** Supported payment provider identifiers */
export type PaymentProviderType = "stripe" | "square";

/** Result of creating a checkout session */
export type CheckoutSessionResult = {
  sessionId: string;
  checkoutUrl: string;
} | null;

/** Result of webhook signature verification */
export type WebhookVerifyResult =
  | { valid: true; event: WebhookEvent }
  | { valid: false; error: string };

/** Provider-agnostic webhook event */
export type WebhookEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

/** Parameters for listing payment sessions */
export type ListSessionsParams = {
  limit: number;
  startingAfter?: string;
};

/** Result of webhook endpoint setup */
export type WebhookSetupResult =
  | { success: true; endpointId: string; secret: string }
  | { success: false; error: string };

/**
 * Payment provider interface.
 *
 * Each provider (Stripe, Square, etc.) implements this interface.
 * Routes call these methods without knowing which provider is active.
 */
export interface PaymentProvider {
  /** Provider identifier */
  readonly type: PaymentProviderType;

  /**
   * Verify a webhook request's signature and parse the event payload.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<WebhookVerifyResult>;

  /**
   * Refund a completed payment.
   * @param paymentReference - provider-specific payment reference (e.g. Stripe payment_intent ID)
   * @returns true if refund succeeded, false otherwise
   */
  refundPayment(paymentReference: string): Promise<boolean>;

  /**
   * Set up a webhook endpoint for this provider.
   * Some providers (e.g. Stripe) support programmatic creation.
   */
  setupWebhookEndpoint(
    secretKey: string,
    webhookUrl: string,
    existingEndpointId?: string | null,
  ): Promise<WebhookSetupResult>;

  /** The webhook event type name that indicates a completed checkout */
  readonly checkoutCompletedEventType: string;

  /**
   * List recent checkout sessions/orders from the provider.
   * Used for the admin orders page.
   */
  listSessions(params: ListSessionsParams): Promise<PaymentSessionListResult>;
}

/** Result of listing payment sessions */
export type PaymentSessionListResult = {
  sessions: PaymentSession[];
  hasMore: boolean;
};

/**
 * Resolve the active payment provider based on admin settings.
 * Lazy-loads the provider module to avoid importing unused SDKs.
 * Returns null if no provider is configured.
 */
export const getActivePaymentProvider =
  async (): Promise<PaymentProvider | null> => {
    const providerType = await paymentsApi.getConfiguredProvider();
    if (!providerType) {
      logDebug("Payment", "No payment provider configured in settings");
      return null;
    }

    logDebug("Payment", `Resolving payment provider: ${providerType}`);

    if (providerType === "stripe") {
      const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
      return stripePaymentProvider;
    }

    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    return squarePaymentProvider;
  };
