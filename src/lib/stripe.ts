/**
 * Stripe API wrapper module
 * Uses lazy loading to avoid importing the Stripe SDK at startup
 */

import type Stripe from "stripe";
import { lazyRef, once } from "#fp";
import {
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "#lib/config.ts";
import { getStripeWebhookEndpointId } from "#lib/db/settings.ts";
import { getEnv } from "#lib/env.ts";
import { ErrorCode, logDebug, logError } from "#lib/logger.ts";
import { computeHmacSha256, hmacToHex, secureCompare } from "#lib/payment-crypto.ts";
import {
  createWithClient,
} from "#lib/payment-helpers.ts";
import type {
  CheckoutSessionResult,
  CreateCheckoutParams,
  WebhookEvent,
  WebhookSetupResult,
  WebhookVerifyResult,
} from "#lib/payments.ts";

/** Lazy-load Stripe SDK only when needed */
const loadStripe = once(async () => {
  const { default: Stripe } = await import("stripe");
  return Stripe;
});

type StripeCache = { client: Stripe; secretKey: string };

/**
 * Extract a privacy-safe error detail from a caught error.
 * Stripe errors expose type/code/statusCode which are safe to log.
 * Raw message is never logged as it may contain PII or secrets.
 */
export const sanitizeErrorDetail = (err: unknown): string => {
  if (!(err instanceof Error)) return "unknown";

  // Stripe SDK errors have statusCode, code, and type properties
  const stripeErr = err as {
    statusCode?: number;
    code?: string;
    type?: string;
  };

  const parts: string[] = [];
  if (stripeErr.statusCode) parts.push(`status=${stripeErr.statusCode}`);
  if (stripeErr.code) parts.push(`code=${stripeErr.code}`);
  if (stripeErr.type) parts.push(`type=${stripeErr.type}`);

  return parts.length > 0 ? parts.join(" ") : err.name;
};

/**
 * Get Stripe client configuration for mock server (if configured)
 */
const getMockConfigImpl = (): Stripe.StripeConfig | undefined => {
  const mockHost = getEnv("STRIPE_MOCK_HOST");
  if (!mockHost) return undefined;

  const mockPort = Number.parseInt(
    getEnv("STRIPE_MOCK_PORT") || "12111",
    10,
  );
  return {
    host: mockHost,
    port: mockPort,
    protocol: "http",
  };
};

const [getMockConfig, setMockConfig] = lazyRef<Stripe.StripeConfig | undefined>(getMockConfigImpl);

const createStripeClient = async (secretKey: string): Promise<Stripe> => {
  const mockConfig = getMockConfig();
  const StripeClass = await loadStripe();
  return mockConfig
    ? new StripeClass(secretKey, mockConfig)
    : new StripeClass(secretKey);
};

const [getCache, setCache] = lazyRef<StripeCache>(() => {
  throw new Error("Stripe cache not initialized");
});

/** Internal getStripeClient implementation */
const getClientImpl = async (): Promise<Stripe | null> => {
  const secretKey = await getStripeSecretKey();
  if (!secretKey) {
    logDebug("Stripe", "No secret key configured, cannot create client");
    return null;
  }

  try {
    const cached = getCache();
    if (cached.secretKey === secretKey) {
      logDebug("Stripe", "Using cached Stripe client");
      return cached.client;
    }
  } catch {
    // Cache not initialized
  }

  logDebug("Stripe", "Creating new Stripe client");
  const client = await createStripeClient(secretKey);
  setCache({ client, secretKey });
  return client;
};

/** Run operation with stripe client, return null if not available */
const withClient = createWithClient(getClientImpl);

/**
 * Stubbable API for testing - allows mocking in ES modules
 * Production code uses stripeApi.method() to enable test mocking
 */
/** Result of listing checkout sessions */
export type StripeSessionListResult = {
  sessions: Stripe.Checkout.Session[];
  hasMore: boolean;
};

export const stripeApi: {
  getStripeClient: () => Promise<Stripe | null>;
  resetStripeClient: () => void;
  createCheckoutSession: (params: CreateCheckoutParams) => Promise<CheckoutSessionResult>;
  retrieveCheckoutSession: (sessionId: string, expand?: string[]) => Promise<Stripe.Checkout.Session | null>;
  retrieveCheckoutSessionExpanded: (sessionId: string) => Promise<Stripe.Checkout.Session | null>;
  listCheckoutSessions: (params: { limit: number; startingAfter?: string }) => Promise<StripeSessionListResult | null>;
  refundPayment: (intentId: string) => Promise<Stripe.Refund | null>;
  setupWebhookEndpoint: (
    secretKey: string,
    webhookUrl: string,
    existingEndpointId?: string | null,
  ) => Promise<WebhookSetupResult>;
  testStripeConnection: () => Promise<StripeConnectionTestResult>;
} = {
  /** Get or create Stripe client */
  getStripeClient: getClientImpl,

  /** Reset Stripe client (for testing) */
  resetStripeClient: (): void => {
    setCache(null);
    setMockConfig(null);
  },

  /** Create a checkout session with line items */
  createCheckoutSession: (
    params: CreateCheckoutParams,
  ): Promise<CheckoutSessionResult> =>
    withClient(
      async (s) => {
        const session = await s.checkout.sessions.create({
          mode: "payment",
          line_items: params.lineItems.map((item) => ({
            price_data: {
              currency: params.currency,
              unit_amount: item.unitPrice,
              product_data: { name: item.name },
            },
            quantity: item.quantity,
          })),
          metadata: params.metadata,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
        });
        if (!session.url) return null;
        return { sessionId: session.id, checkoutUrl: session.url };
      },
      ErrorCode.STRIPE_CHECKOUT,
    ),

  /** Retrieve a checkout session by ID, optionally expanding related objects */
  retrieveCheckoutSession: (
    sessionId: string,
    expand?: string[],
  ): Promise<Stripe.Checkout.Session | null> =>
    withClient(
      (s) => s.checkout.sessions.retrieve(
        sessionId,
        expand ? { expand } : undefined,
      ),
      ErrorCode.STRIPE_SESSION,
    ),

  /** Retrieve a checkout session with line items and customer details expanded */
  retrieveCheckoutSessionExpanded: (
    sessionId: string,
  ): Promise<Stripe.Checkout.Session | null> =>
    stripeApi.retrieveCheckoutSession(
      sessionId,
      ["line_items", "customer_details"],
    ),

  /** List checkout sessions */
  listCheckoutSessions: (
    params: { limit: number; startingAfter?: string },
  ): Promise<StripeSessionListResult | null> =>
    withClient(
      async (s) => {
        const listParams: Stripe.Checkout.SessionListParams = {
          limit: params.limit,
        };
        if (params.startingAfter) {
          listParams.starting_after = params.startingAfter;
        }
        const result = await s.checkout.sessions.list(listParams);
        return {
          sessions: result.data,
          hasMore: result.has_more,
        };
      },
      ErrorCode.STRIPE_SESSION,
    ),

  /** Refund a payment */
  refundPayment: (intentId: string): Promise<Stripe.Refund | null> =>
    withClient(
      (s) => s.refunds.create({ payment_intent: intentId }),
      ErrorCode.STRIPE_REFUND,
    ),

  /** Test Stripe connection: verify API key and webhook endpoint */
  testStripeConnection: async (): Promise<StripeConnectionTestResult> => {
    const result: StripeConnectionTestResult = {
      ok: false,
      apiKey: { valid: false },
      webhook: { configured: false },
    };

    // Step 1: Test API key by retrieving balance
    const client = await getClientImpl();
    if (!client) {
      result.apiKey.error = "No Stripe secret key configured";
      return result;
    }

    try {
      const balance = await client.balance.retrieve();
      const hasLiveKey = balance.livemode;
      result.apiKey = {
        valid: true,
        mode: hasLiveKey ? "live" : "test",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      result.apiKey = { valid: false, error: message };
      return result;
    }

    // Step 2: Test webhook endpoint
    const endpointId = await getStripeWebhookEndpointId();
    if (!endpointId) {
      result.webhook = { configured: false, error: "No webhook endpoint ID stored" };
      return result;
    }

    try {
      const endpoint = await client.webhookEndpoints.retrieve(endpointId);
      result.webhook = {
        configured: true,
        endpointId: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        enabledEvents: endpoint.enabled_events,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      result.webhook = { configured: false, endpointId, error: message };
      return result;
    }

    result.ok = result.apiKey.valid && result.webhook.configured;
    return result;
  },

  // Placeholder - will be set after setupWebhookEndpointImpl is defined
  setupWebhookEndpoint: null as unknown as (
    secretKey: string,
    webhookUrl: string,
    existingEndpointId?: string | null,
  ) => Promise<WebhookSetupResult>,
};

/**
 * Internal implementation of webhook endpoint setup.
 * Use setupWebhookEndpoint export for production code.
 */
const setupWebhookEndpointImpl = async (
  secretKey: string,
  webhookUrl: string,
  existingEndpointId?: string | null,
): Promise<WebhookSetupResult> => {
  try {
    const client = await createStripeClient(secretKey);

    // If we have an existing endpoint ID, try to delete it so we can recreate
    // (update doesn't return the secret, so we need to recreate to get a fresh one)
    if (existingEndpointId) {
      try {
        await client.webhookEndpoints.del(existingEndpointId);
      } catch {
        // Endpoint doesn't exist or can't be deleted, will create new one
      }
    }

    // Check if a webhook already exists for this exact URL
    const existingEndpoints = await client.webhookEndpoints.list({ limit: 100 });
    const existingForUrl = existingEndpoints.data.find(
      (ep) => ep.url === webhookUrl,
    );

    if (existingForUrl) {
      // Delete existing endpoint to recreate with fresh secret
      await client.webhookEndpoints.del(existingForUrl.id);
    }

    // Create new webhook endpoint
    const endpoint = await client.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: ["checkout.session.completed"],
    });

    if (!endpoint.secret) {
      return { success: false, error: "Stripe did not return webhook secret" };
    }

    return {
      success: true,
      endpointId: endpoint.id,
      secret: endpoint.secret,
    };
  } catch (err) {
    logError({ code: ErrorCode.STRIPE_WEBHOOK_SETUP, detail: sanitizeErrorDetail(err) });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// Add setupWebhookEndpoint to stripeApi for testability
stripeApi.setupWebhookEndpoint = setupWebhookEndpointImpl;

/**
 * Create or update a webhook endpoint for the given URL.
 * If an endpoint already exists for this URL, updates it.
 * Returns the webhook secret for signature verification.
 *
 * @param secretKey - Stripe secret key to use (passed directly since this runs before key is stored)
 * @param webhookUrl - Full URL for the webhook endpoint
 * @param existingEndpointId - Optional existing endpoint ID to update
 */
export const setupWebhookEndpoint = (
  secretKey: string,
  webhookUrl: string,
  existingEndpointId?: string | null,
): Promise<WebhookSetupResult> =>
  stripeApi.setupWebhookEndpoint(secretKey, webhookUrl, existingEndpointId);

// Wrapper functions that delegate to stripeApi at runtime (enables test mocking)
export const getStripeClient = () => stripeApi.getStripeClient();
export const resetStripeClient = () => stripeApi.resetStripeClient();
export const createCheckoutSession = (params: CreateCheckoutParams) =>
  stripeApi.createCheckoutSession(params);
export const retrieveCheckoutSession = (sessionId: string) =>
  stripeApi.retrieveCheckoutSession(sessionId);
export const retrieveCheckoutSessionExpanded = (sessionId: string) =>
  stripeApi.retrieveCheckoutSessionExpanded(sessionId);
export const listCheckoutSessions = (params: { limit: number; startingAfter?: string }) =>
  stripeApi.listCheckoutSessions(params);
export const refundPayment = (id: string) => stripeApi.refundPayment(id);
export const testStripeConnection = () => stripeApi.testStripeConnection();

/**
 * =============================================================================
 * Webhook Signature Verification (Web Crypto API for Edge compatibility)
 * =============================================================================
 * Implements Stripe webhook signature verification without the Stripe SDK.
 * Uses HMAC-SHA256 via Web Crypto API for Bunny Edge Scripts compatibility.
 */

/** Default timestamp tolerance: 5 minutes (300 seconds) */
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Parse Stripe signature header into components */
const parseSignatureHeader = (
  header: string,
): { timestamp: number; signatures: string[] } | null => {
  const parts = header.split(",");
  let timestamp = 0;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = Number.parseInt(value ?? "0", 10);
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (timestamp === 0 || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
};

/** Compute HMAC-SHA256 and return hex-encoded result (Stripe format) */
const computeSignature = async (
  payload: string,
  secret: string,
): Promise<string> => hmacToHex(await computeHmacSha256(payload, secret));

/** Stripe webhook event - alias for the provider-agnostic WebhookEvent */
export type StripeWebhookEvent = WebhookEvent;
export type { WebhookSetupResult, WebhookVerifyResult };

/** Result of testing the Stripe connection */
export type StripeConnectionTestResult = {
  ok: boolean;
  apiKey: { valid: boolean; error?: string; mode?: string };
  webhook: {
    configured: boolean;
    endpointId?: string;
    url?: string;
    status?: string;
    enabledEvents?: string[];
    error?: string;
  };
};

/**
 * Verify Stripe webhook signature using Web Crypto API.
 * Compatible with edge runtimes (Bunny Edge Scripts, Cloudflare Workers, Deno Deploy).
 *
 * @param payload - Raw request body as string
 * @param signature - Stripe-Signature header value
 * @param toleranceSeconds - Max age of event in seconds (default: 300)
 */
export const verifyWebhookSignature = async (
  payload: string,
  signature: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): Promise<WebhookVerifyResult> => {
  const secret = await getStripeWebhookSecret();
  if (!secret) {
    logError({ code: ErrorCode.CONFIG_MISSING, detail: "webhook secret" });
    return { valid: false, error: "Webhook secret not configured" };
  }

  const parsed = parseSignatureHeader(signature);
  if (!parsed) {
    logError({ code: ErrorCode.STRIPE_SIGNATURE, detail: "invalid header format" });
    return { valid: false, error: "Invalid signature header format" };
  }

  const { timestamp, signatures } = parsed;

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    logError({ code: ErrorCode.STRIPE_SIGNATURE, detail: "timestamp out of tolerance" });
    return { valid: false, error: "Timestamp outside tolerance window" };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = await computeSignature(signedPayload, secret);

  // Check if any signature matches (constant-time)
  const isValid = signatures.some((sig) => secureCompare(sig, expectedSignature));

  if (!isValid) {
    logError({ code: ErrorCode.STRIPE_SIGNATURE, detail: "mismatch" });
    return { valid: false, error: "Signature verification failed" };
  }

  // Parse and return the event
  try {
    const event = JSON.parse(payload) as StripeWebhookEvent;
    return { valid: true, event };
  } catch {
    logError({ code: ErrorCode.STRIPE_SIGNATURE, detail: "invalid JSON" });
    return { valid: false, error: "Invalid JSON payload" };
  }
};

/**
 * Construct a test webhook event (for testing purposes).
 * Generates a valid signature for the given payload.
 */
export const constructTestWebhookEvent = async (
  event: StripeWebhookEvent,
  secret: string,
): Promise<{ payload: string; signature: string }> => {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = await computeSignature(signedPayload, secret);

  return {
    payload,
    signature: `t=${timestamp},v1=${sig}`,
  };
};
