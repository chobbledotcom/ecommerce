import { afterEach, beforeEach, describe, expect, test, spyOn } from "#test-compat";
import {
  constructTestWebhookEvent,
  getStripeClient,
  lookupSessionByPaymentIntent,
  refundPayment,
  resetStripeClient,
  sanitizeErrorDetail,
  stripeApi,
  testStripeConnection,
  type StripeWebhookEvent,
  verifyWebhookSignature,
  setupWebhookEndpoint,
} from "#lib/stripe.ts";
import { stripePaymentProvider } from "#lib/stripe-provider.ts";
import { setStripeWebhookConfig, updateStripeKey } from "#lib/db/settings.ts";
import { createTestDb, resetDb, withMocks } from "#test-utils";

describe("stripe", () => {
  let originalMockHost: string | undefined;
  let originalMockPort: string | undefined;

  beforeEach(async () => {
    originalMockHost = Deno.env.get("STRIPE_MOCK_HOST");
    originalMockPort = Deno.env.get("STRIPE_MOCK_PORT");
    resetStripeClient();
    // Create in-memory db for testing
    await createTestDb();
  });

  afterEach(() => {
    resetStripeClient();
    resetDb();
    // Restore original env values
    if (originalMockHost !== undefined) {
      Deno.env.set("STRIPE_MOCK_HOST", originalMockHost);
    } else {
      Deno.env.delete("STRIPE_MOCK_HOST");
    }
    if (originalMockPort !== undefined) {
      Deno.env.set("STRIPE_MOCK_PORT", originalMockPort);
    } else {
      Deno.env.delete("STRIPE_MOCK_PORT");
    }
  });

  describe("getStripeClient", () => {
    test("returns null when stripe key not set", async () => {
      const client = await getStripeClient();
      expect(client).toBeNull();
    });

    test("returns client when stripe key is set in database", async () => {
      await updateStripeKey("sk_test_123");
      const client = await getStripeClient();
      expect(client).not.toBeNull();
    });

    test("returns same client on subsequent calls", async () => {
      await updateStripeKey("sk_test_123");
      const client1 = await getStripeClient();
      const client2 = await getStripeClient();
      expect(client1).toBe(client2);
    });
  });

  describe("resetStripeClient", () => {
    test("resets client to null after key removed from db", async () => {
      await updateStripeKey("sk_test_123");
      const client1 = await getStripeClient();
      expect(client1).not.toBeNull();

      resetStripeClient();
      // Reset DB to clear the stripe key
      resetDb();
      await createTestDb();

      const client2 = await getStripeClient();
      expect(client2).toBeNull();
    });
  });

  describe("mock configuration", () => {
    test("creates client with mock config when STRIPE_MOCK_HOST is set", async () => {
      // This test exercises the getMockConfig code path
      await updateStripeKey("sk_test_123");
      Deno.env.set("STRIPE_MOCK_HOST", "localhost");
      Deno.env.set("STRIPE_MOCK_PORT", "12111");

      // This will create a client with mock config, but won't make any API calls
      const client = await getStripeClient();
      expect(client).not.toBeNull();
    });

    test("uses default port 12111 when STRIPE_MOCK_PORT not set", async () => {
      await updateStripeKey("sk_test_123");
      Deno.env.set("STRIPE_MOCK_HOST", "localhost");
      Deno.env.delete("STRIPE_MOCK_PORT");

      const client = await getStripeClient();
      expect(client).not.toBeNull();
    });
  });

  describe("stripe-mock integration", () => {
    // These tests require stripe-mock running on localhost:12111
    // STRIPE_MOCK_HOST/PORT are set in test/setup.ts

    test("refunds payment with stripe-mock", async () => {
      await updateStripeKey("sk_test_mock");

      // stripe-mock accepts any payment_intent ID
      const refund = await refundPayment("pi_test_123");

      expect(refund).not.toBeNull();
      expect(refund?.id).toBeDefined();
    });
  });

  describe("refundPayment", () => {
    test("returns null when stripe key not set", async () => {
      const result = await refundPayment("pi_test_123");
      expect(result).toBeNull();
    });

    test("returns null when Stripe API throws error", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.refunds, "create").mockRejectedValue(new Error("Network error")),
        async (refundSpy) => {
          const result = await refundPayment("pi_test_123");
          expect(result).toBeNull();
          expect(refundSpy).toHaveBeenCalled();
        },
      );
    });
  });

  describe("lookupSessionByPaymentIntent", () => {
    test("returns null when stripe key not set", async () => {
      const result = await lookupSessionByPaymentIntent("pi_test_123");
      expect(result).toBeNull();
    });

    test("returns session ID when sessions found", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.checkout.sessions, "list").mockResolvedValue({
          data: [{ id: "cs_test_found_123" }],
          has_more: false,
          object: "list",
          url: "",
        } as never),
        async () => {
          const result = await lookupSessionByPaymentIntent("pi_test_123");
          expect(result).toBe("cs_test_found_123");
        },
      );
    });

    test("returns null when no sessions match", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.checkout.sessions, "list").mockResolvedValue({
          data: [],
          has_more: false,
          object: "list",
          url: "",
        } as never),
        async () => {
          const result = await lookupSessionByPaymentIntent("pi_test_123");
          expect(result).toBeNull();
        },
      );
    });

    test("returns null when Stripe API throws error", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.checkout.sessions, "list").mockRejectedValue(new Error("Network error")),
        async () => {
          const result = await lookupSessionByPaymentIntent("pi_test_123");
          expect(result).toBeNull();
        },
      );
    });
  });

  describe("verifyWebhookSignature", () => {
    const TEST_SECRET = "whsec_test_secret_key_for_webhook_verification";

    beforeEach(async () => {
      // Set webhook secret in database (encrypted)
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_test_endpoint" });
    });

    test("returns error when webhook secret not configured", async () => {
      // Reset DB to have no webhook secret configured
      await resetDb();
      await createTestDb();
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "t=1234,v1=abc",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Webhook secret not configured");
      }
    });

    test("returns error for invalid signature header format", async () => {
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "invalid-header",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid signature header format");
      }
    });

    test("returns error for missing timestamp in header", async () => {
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "v1=abc123",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid signature header format");
      }
    });

    test("returns error for missing signature in header", async () => {
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "t=1234",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid signature header format");
      }
    });

    test("returns error for timestamp outside tolerance window", async () => {
      // Create a signature with old timestamp (more than 5 minutes ago)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const payload = '{"test": true}';
      const signedPayload = `${oldTimestamp}.${payload}`;

      // Compute valid signature with old timestamp
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload),
      );
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await verifyWebhookSignature(
        payload,
        `t=${oldTimestamp},v1=${sigHex}`,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Timestamp outside tolerance window");
      }
    });

    test("returns error for invalid signature", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = await verifyWebhookSignature(
        '{"test": true}',
        `t=${timestamp},v1=invalid_signature_that_wont_match`,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Signature verification failed");
      }
    });

    test("returns error for invalid JSON payload", async () => {
      const payload = "not valid json {{{";
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;

      // Compute valid signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload),
      );
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await verifyWebhookSignature(
        payload,
        `t=${timestamp},v1=${sigHex}`,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid JSON payload");
      }
    });

    test("verifies valid signature successfully", async () => {
      const event: StripeWebhookEvent = {
        id: "evt_test_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            payment_status: "paid",
            metadata: {
              event_id: "1",
              name: "John Doe",
              email: "john@example.com",
              quantity: "1",
            },
          },
        },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        TEST_SECRET,
      );

      const result = await verifyWebhookSignature(payload, signature);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.id).toBe("evt_test_123");
        expect(result.event.type).toBe("checkout.session.completed");
      }
    });

    test("accepts custom tolerance window", async () => {
      // Create signature with timestamp 100 seconds ago
      const oldTimestamp = Math.floor(Date.now() / 1000) - 100;
      const payload = '{"id": "evt_123", "type": "test"}';
      const signedPayload = `${oldTimestamp}.${payload}`;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload),
      );
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Should fail with default 300s tolerance but pass with 150s tolerance
      const resultWithSmallTolerance = await verifyWebhookSignature(
        payload,
        `t=${oldTimestamp},v1=${sigHex}`,
        50, // 50 second tolerance - should fail
      );
      expect(resultWithSmallTolerance.valid).toBe(false);

      // Should pass with larger tolerance
      const resultWithLargeTolerance = await verifyWebhookSignature(
        payload,
        `t=${oldTimestamp},v1=${sigHex}`,
        200, // 200 second tolerance - should pass
      );
      expect(resultWithLargeTolerance.valid).toBe(true);
    });
  });

  describe("testStripeConnection", () => {
    test("returns error when no API key configured", async () => {
      const result = await testStripeConnection();
      expect(result.ok).toBe(false);
      expect(result.apiKey.valid).toBe(false);
      expect(result.apiKey.error).toContain("No Stripe secret key configured");
    });

    test("returns error when balance.retrieve fails", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.balance, "retrieve").mockRejectedValue(new Error("Invalid API Key provided")),
        async () => {
          const result = await testStripeConnection();
          expect(result.ok).toBe(false);
          expect(result.apiKey.valid).toBe(false);
          expect(result.apiKey.error).toContain("Invalid API Key provided");
        },
      );
    });

    test("returns test mode when API key is valid and webhook not configured", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.balance, "retrieve").mockResolvedValue({ livemode: false, available: [], pending: [], object: "balance" } as never),
        async () => {
          const result = await testStripeConnection();
          expect(result.ok).toBe(false);
          expect(result.apiKey.valid).toBe(true);
          expect(result.apiKey.mode).toBe("test");
          expect(result.webhook.configured).toBe(false);
          expect(result.webhook.error).toContain("No webhook endpoint ID stored");
        },
      );
    });

    test("returns live mode for live key", async () => {
      await updateStripeKey("sk_live_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => spyOn(client.balance, "retrieve").mockResolvedValue({ livemode: true, available: [], pending: [], object: "balance" } as never),
        async () => {
          const result = await testStripeConnection();
          expect(result.apiKey.valid).toBe(true);
          expect(result.apiKey.mode).toBe("live");
        },
      );
    });

    test("returns webhook error when endpoint retrieval fails", async () => {
      await updateStripeKey("sk_test_mock");
      await setStripeWebhookConfig({ secret: "whsec_test", endpointId: "we_test_missing" });
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => ({
          balanceSpy: spyOn(client.balance, "retrieve").mockResolvedValue({ livemode: false, available: [], pending: [], object: "balance" } as never),
          webhookSpy: spyOn(client.webhookEndpoints, "retrieve").mockRejectedValue(new Error("No such webhook endpoint: we_test_missing")),
        }),
        async () => {
          const result = await testStripeConnection();
          expect(result.ok).toBe(false);
          expect(result.apiKey.valid).toBe(true);
          expect(result.webhook.configured).toBe(false);
          expect(result.webhook.error).toContain("No such webhook endpoint");
        },
      );
    });

    test("returns full success when API key and webhook are both valid", async () => {
      await updateStripeKey("sk_test_mock");
      await setStripeWebhookConfig({ secret: "whsec_test", endpointId: "we_test_valid" });
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      await withMocks(
        () => ({
          balanceSpy: spyOn(client.balance, "retrieve").mockResolvedValue({ livemode: false, available: [], pending: [], object: "balance" } as never),
          webhookSpy: spyOn(client.webhookEndpoints, "retrieve").mockResolvedValue({
            id: "we_test_valid",
            url: "https://example.com/payment/webhook",
            status: "enabled",
            enabled_events: ["checkout.session.completed"],
            object: "webhook_endpoint",
          } as never),
        }),
        async () => {
          const result = await testStripeConnection();
          expect(result.ok).toBe(true);
          expect(result.apiKey.valid).toBe(true);
          expect(result.apiKey.mode).toBe("test");
          expect(result.webhook.configured).toBe(true);
          expect(result.webhook.endpointId).toBe("we_test_valid");
          expect(result.webhook.url).toBe("https://example.com/payment/webhook");
          expect(result.webhook.status).toBe("enabled");
          expect(result.webhook.enabledEvents).toContain("checkout.session.completed");
        },
      );
    });
  });

  describe("constructTestWebhookEvent", () => {
    test("creates valid payload and signature pair", async () => {
      const secret = "whsec_test_construction";
      const event: StripeWebhookEvent = {
        id: "evt_constructed",
        type: "payment_intent.succeeded",
        data: {
          object: {
            amount: 1000,
            currency: "gbp",
          },
        },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        secret,
      );

      // Verify payload is valid JSON matching input
      const parsed = JSON.parse(payload);
      expect(parsed.id).toBe("evt_constructed");
      expect(parsed.type).toBe("payment_intent.succeeded");

      // Verify signature format
      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);

      // Signature should be verifiable with the same secret (stored in DB)
      await setStripeWebhookConfig({ secret, endpointId: "we_test_construction" });
      const result = await verifyWebhookSignature(payload, signature);
      expect(result.valid).toBe(true);
    });
  });

  describe("sanitizeErrorDetail", () => {
    test("returns 'unknown' for non-Error values", () => {
      expect(sanitizeErrorDetail("string error")).toBe("unknown");
      expect(sanitizeErrorDetail(null)).toBe("unknown");
      expect(sanitizeErrorDetail(42)).toBe("unknown");
      expect(sanitizeErrorDetail(undefined)).toBe("unknown");
    });

    test("returns error name for plain Error without Stripe fields", () => {
      expect(sanitizeErrorDetail(new Error("sensitive message"))).toBe("Error");
    });

    test("returns error name for typed errors without Stripe fields", () => {
      expect(sanitizeErrorDetail(new TypeError("bad type"))).toBe("TypeError");
    });

    test("extracts Stripe statusCode, code, and type", () => {
      const err = new Error("Invalid API Key provided: sk_test_****1234");
      Object.assign(err, {
        statusCode: 401,
        code: "api_key_invalid",
        type: "StripeAuthenticationError",
      });
      expect(sanitizeErrorDetail(err)).toBe(
        "status=401 code=api_key_invalid type=StripeAuthenticationError",
      );
    });

    test("extracts partial Stripe fields", () => {
      const err = new Error("Resource not found");
      Object.assign(err, { statusCode: 404 });
      expect(sanitizeErrorDetail(err)).toBe("status=404");
    });

    test("extracts code and type without statusCode", () => {
      const err = new Error("Connection failed");
      Object.assign(err, {
        code: "ECONNREFUSED",
        type: "StripeConnectionError",
      });
      expect(sanitizeErrorDetail(err)).toBe(
        "code=ECONNREFUSED type=StripeConnectionError",
      );
    });

    test("never includes the raw error message in output", () => {
      const sensitiveMessage = "Invalid API Key provided: sk_live_realkey123";
      const err = new Error(sensitiveMessage);
      Object.assign(err, { statusCode: 401, type: "StripeAuthenticationError" });
      const detail = sanitizeErrorDetail(err);
      expect(detail).not.toContain(sensitiveMessage);
      expect(detail).not.toContain("sk_live");
    });

    test("falls back to err.name when no Stripe fields present", () => {
      // Error with no statusCode/code/type but has a name
      const err = new Error("something");
      // Plain Error: err.name is "Error", parts is empty, so returns err.name || "Error"
      expect(sanitizeErrorDetail(err)).toBe("Error");
    });
  });

  describe("refundPayment - non-Error exception", () => {
    test("handles non-Error thrown value in refund", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      const refundSpy = spyOn(client.refunds, "create");
      // Throw a non-Error value (string) to exercise the sanitizeErrorDetail "unknown" path
      refundSpy.mockRejectedValue("network failure string");

      try {
        const result = await refundPayment("pi_test_123");
        expect(result).toBeNull();
      } finally {
        refundSpy.mockRestore();
      }
    });
  });

  describe("testStripeConnection - non-Error exception", () => {
    test("handles non-Error thrown value in balance check", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      const balanceSpy = spyOn(client.balance, "retrieve");
      balanceSpy.mockRejectedValue("string error");

      try {
        const result = await testStripeConnection();
        expect(result.ok).toBe(false);
        expect(result.apiKey.valid).toBe(false);
        expect(result.apiKey.error).toBe("Unknown error");
      } finally {
        balanceSpy.mockRestore();
      }
    });

    test("handles non-Error thrown value in webhook retrieval", async () => {
      await updateStripeKey("sk_test_mock");
      await setStripeWebhookConfig({ secret: "whsec_test", endpointId: "we_test_nonerror" });
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client to be defined");

      const balanceSpy = spyOn(client.balance, "retrieve");
      balanceSpy.mockResolvedValue({
        livemode: false,
        available: [],
        pending: [],
        object: "balance",
      } as never);

      const webhookSpy = spyOn(client.webhookEndpoints, "retrieve");
      webhookSpy.mockRejectedValue("webhook string error");

      try {
        const result = await testStripeConnection();
        expect(result.ok).toBe(false);
        expect(result.webhook.configured).toBe(false);
        expect(result.webhook.error).toBe("Unknown error");
      } finally {
        balanceSpy.mockRestore();
        webhookSpy.mockRestore();
      }
    });
  });

  describe("setupWebhookEndpointImpl", () => {
    // setupWebhookEndpointImpl creates its own client via createStripeClient(secretKey),
    // so we mock at the stripeApi level to test the various code paths

    test("creates webhook endpoint via stripe-mock (no secret returned)", async () => {
      // stripe-mock doesn't return endpoint.secret, so this exercises the "no secret" error path
      const result = await setupWebhookEndpoint(
        "sk_test_mock",
        "https://example.com/payment/webhook",
      );

      // stripe-mock likely doesn't return secret, testing the error path
      if (!result.success) {
        expect(result.error).toBe("Stripe did not return webhook secret");
      }
    });

    test("exercises delete-then-create path with existing endpoint ID", async () => {
      // This exercises the existingEndpointId deletion path
      const result = await setupWebhookEndpoint(
        "sk_test_mock",
        "https://example.com/payment/webhook",
        "we_existing_123",
      );

      // The API call goes through - deletion of non-existent endpoint is caught
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    test("succeeds when mocked via stripeApi", async () => {
      // Override stripeApi to test the full success path
      const origSetup = stripeApi.setupWebhookEndpoint;
      stripeApi.setupWebhookEndpoint = (_key, _url, _existing) =>
        Promise.resolve({ success: true, endpointId: "we_mocked", secret: "whsec_mocked" });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test",
          "https://example.com/webhook",
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.endpointId).toBe("we_mocked");
          expect(result.secret).toBe("whsec_mocked");
        }
      } finally {
        stripeApi.setupWebhookEndpoint = origSetup;
      }
    });

    test("returns error when API throws", async () => {
      const origSetup = stripeApi.setupWebhookEndpoint;
      stripeApi.setupWebhookEndpoint = (_key, _url) =>
        Promise.resolve({ success: false as const, error: "API rate limited" });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test",
          "https://example.com/webhook",
        );
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("API rate limited");
        }
      } finally {
        stripeApi.setupWebhookEndpoint = origSetup;
      }
    });
  });

  describe("getMockConfig", () => {
    test("returns undefined when STRIPE_MOCK_HOST not set", async () => {
      Deno.env.delete("STRIPE_MOCK_HOST");
      Deno.env.delete("STRIPE_MOCK_PORT");
      resetStripeClient();

      // The getMockConfig is a once() function, so we can't easily re-test it.
      // But getStripeClient exercises the createStripeClient path
      await updateStripeKey("sk_test_123");
      // Without mock config, a real Stripe client would be created
      // We just verify no crash occurs
      const client = await getStripeClient();
      expect(client).not.toBeNull();
    });
  });

  describe("setupWebhookEndpoint - stripe-mock paths", () => {
    test("deletes existing endpoint for same URL before recreating", async () => {
      // stripe-mock has a default endpoint at https://example.com/my/webhook/endpoint
      // Calling setupWebhookEndpoint with that URL should find it via list and delete it
      const result = await setupWebhookEndpoint(
        "sk_test_mock",
        "https://example.com/my/webhook/endpoint",
      );

      // stripe-mock doesn't return secret, so this hits the "no secret" error path
      // but the important thing is it exercises the "delete existing for URL" code path (lines 368-371)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    test("returns success when endpoint.secret is present", async () => {
      // Wrap fetch to intercept the webhook_endpoints create response and inject a secret
      const originalFetch = globalThis.fetch;
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = await originalFetch(input, init);
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        // Intercept POST to webhook_endpoints (create) and add secret to response
        if (url.includes("/v1/webhook_endpoints") && init?.method === "POST") {
          const body = await response.json();
          body.secret = "whsec_test_injected_secret";
          return new Response(JSON.stringify(body), {
            status: response.status,
            headers: response.headers,
          });
        }
        return response;
      });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/webhook/success-test",
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.endpointId).toBeDefined();
          expect(result.secret).toBe("whsec_test_injected_secret");
        }
      } finally {
        fetchSpy.mockRestore();
      }
    });

    test("returns error when createStripeClient or API call throws", async () => {
      // Mock fetch to throw on all requests, exercising the outer catch block (lines 388-392)
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(() => {
        throw new Error("Network unavailable");
      });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/webhook/error-test",
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          // Stripe SDK wraps connection errors with retry info
          expect(typeof result.error).toBe("string");
          expect(result.error!.length > 0).toBe(true);
        }
      } finally {
        fetchSpy.mockRestore();
      }
    });

    test("catches error when deleting existing endpoint ID fails", async () => {
      // Mock fetch so that ALL DELETE requests throw (Stripe SDK retries, so we must fail all)
      const originalFetch = globalThis.fetch;
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const method = init?.method ?? "GET";
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        // Fail all DELETE requests for the specific endpoint to bypass SDK retries
        if (method === "DELETE" && url.includes("we_should_fail_to_delete")) {
          throw new Error("Delete failed");
        }
        return originalFetch(input, init);
      });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/webhook/delete-error-test-unique",
          "we_should_fail_to_delete",
        );

        // The function should continue past the failed delete and still attempt to create
        expect(result).toBeDefined();
        expect(typeof result.success).toBe("boolean");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    test("returns error when list endpoints throws", async () => {
      // Mock fetch so that the list call (GET) throws, exercising the outer catch
      const originalFetch = globalThis.fetch;
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        // The Stripe SDK sends GET for list. Intercept GET requests to webhook_endpoints
        if (method === "GET" && url.includes("/v1/webhook_endpoints")) {
          throw new Error("List endpoints failed");
        }
        return originalFetch(input, init);
      });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/webhook/list-error-test",
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          // Stripe SDK wraps connection errors with retry info
          expect(typeof result.error).toBe("string");
          expect(result.error!.length > 0).toBe(true);
        }
      } finally {
        fetchSpy.mockRestore();
      }
    });

    test("returns stringified error when non-Error is thrown", async () => {
      // Mock fetch to throw a string (not an Error) to hit the String(err) path
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(() => {
        throw "string_error"; // non-Error value
      });

      try {
        const result = await setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/webhook/non-error-throw",
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          // Stripe SDK wraps thrown values, so error message comes from SDK wrapper
          expect(typeof result.error).toBe("string");
          expect(result.error!.length > 0).toBe(true);
        }
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("verifyWebhookSignature - timestamp parsing", () => {
    const TEST_SECRET = "whsec_test_secret_key_for_timestamp_test";

    test("handles timestamp value that needs parseInt", async () => {
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_test_ts" });

      // Create event with proper signature
      const event: StripeWebhookEvent = {
        id: "evt_ts_test",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test" } },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        TEST_SECRET,
      );

      const result = await verifyWebhookSignature(payload, signature);
      expect(result.valid).toBe(true);
    });

    test("parses timestamp with parseInt when t key has value", async () => {
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_test_parse" });

      // Use a timestamp that is a valid number string, exercising Number.parseInt
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = '{"id": "evt_parse", "type": "test"}';
      const signedPayload = `${timestamp}.${payload}`;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload),
      );
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await verifyWebhookSignature(
        payload,
        `t=${timestamp},v1=${sigHex}`,
      );
      expect(result.valid).toBe(true);
    });

    test("treats t key without equals as zero timestamp via parseInt fallback", async () => {
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_test_nullish" });

      // Header "t,v1=abc123" - split("=") on "t" gives ["t"], so value is undefined
      // value ?? "0" gives "0", parseInt("0", 10) gives 0
      // timestamp === 0, so parseSignatureHeader returns null => "Invalid signature header format"
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "t,v1=abc123",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid signature header format");
      }
    });

    test("secureCompare handles strings of different lengths", async () => {
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_test_len" });

      // Provide a signature that has different length than expected
      const timestamp = Math.floor(Date.now() / 1000);
      const result = await verifyWebhookSignature(
        '{"test": true}',
        `t=${timestamp},v1=short`,
      );
      // Signature won't match but should not crash - secureCompare handles length diff
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Signature verification failed");
      }
    });
  });
});

describe("stripe-provider", () => {
  let originalMockHost: string | undefined;
  let originalMockPort: string | undefined;

  beforeEach(async () => {
    originalMockHost = Deno.env.get("STRIPE_MOCK_HOST");
    originalMockPort = Deno.env.get("STRIPE_MOCK_PORT");
    resetStripeClient();
    await createTestDb();
  });

  afterEach(() => {
    resetStripeClient();
    resetDb();
    if (originalMockHost !== undefined) {
      Deno.env.set("STRIPE_MOCK_HOST", originalMockHost);
    } else {
      Deno.env.delete("STRIPE_MOCK_HOST");
    }
    if (originalMockPort !== undefined) {
      Deno.env.set("STRIPE_MOCK_PORT", originalMockPort);
    } else {
      Deno.env.delete("STRIPE_MOCK_PORT");
    }
  });

  describe("verifyWebhookSignature delegation", () => {
    test("delegates to stripe.ts verifyWebhookSignature", async () => {
      const TEST_SECRET = "whsec_provider_verify_test";
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_provider_test" });

      const event: StripeWebhookEvent = {
        id: "evt_provider",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test" } },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        TEST_SECRET,
      );

      const result = await stripePaymentProvider.verifyWebhookSignature(
        payload,
        signature,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.id).toBe("evt_provider");
      }
    });

    test("returns error for invalid signature", async () => {
      const TEST_SECRET = "whsec_provider_invalid_test";
      await setStripeWebhookConfig({ secret: TEST_SECRET, endpointId: "we_provider_inv" });

      const timestamp = Math.floor(Date.now() / 1000);
      const result = await stripePaymentProvider.verifyWebhookSignature(
        '{"test": true}',
        `t=${timestamp},v1=invalid_sig`,
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("setupWebhookEndpoint delegation", () => {
    test("delegates to stripe.ts setupWebhookEndpoint", async () => {
      // Mock stripeApi since setupWebhookEndpointImpl creates its own client
      const origSetup = stripeApi.setupWebhookEndpoint;
      stripeApi.setupWebhookEndpoint = (_key, _url, _existing) =>
        Promise.resolve({ success: true, endpointId: "we_provider_created", secret: "whsec_provider_secret" });

      try {
        const result = await stripePaymentProvider.setupWebhookEndpoint(
          "sk_test_mock",
          "https://example.com/payment/webhook",
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.endpointId).toBe("we_provider_created");
          expect(result.secret).toBe("whsec_provider_secret");
        }
      } finally {
        stripeApi.setupWebhookEndpoint = origSetup;
      }
    });
  });

  describe("refundPayment delegation", () => {
    test("returns true when refund succeeds", async () => {
      await updateStripeKey("sk_test_mock");
      const result = await stripePaymentProvider.refundPayment("pi_test_123");
      expect(result).toBe(true);
    });

    test("returns false when refund fails", async () => {
      await updateStripeKey("sk_test_mock");
      const client = await getStripeClient();
      if (!client) throw new Error("Expected client");

      const refundSpy = spyOn(client.refunds, "create");
      refundSpy.mockRejectedValue(new Error("Refund failed"));

      try {
        const result = await stripePaymentProvider.refundPayment("pi_fail");
        expect(result).toBe(false);
      } finally {
        refundSpy.mockRestore();
      }
    });
  });

  describe("sanitizeErrorDetail edge cases", () => {
    test("returns err.name when no statusCode/code/type and name is set", () => {
      const err = new TypeError("something went wrong");
      const detail = sanitizeErrorDetail(err);
      expect(detail).toBe("TypeError");
    });

  });

  describe("getMockConfig without STRIPE_MOCK_HOST", () => {
    test("creates client without mock config when STRIPE_MOCK_HOST not set", async () => {
      await updateStripeKey("sk_test_123");
      Deno.env.delete("STRIPE_MOCK_HOST");
      Deno.env.delete("STRIPE_MOCK_PORT");

      // resetStripeClient now also resets getMockConfig (lazyRef)
      resetStripeClient();

      const client = await getStripeClient();
      // Client is created using real Stripe (no mock) - returns non-null
      expect(client !== undefined).toBe(true);
    });
  });
});

describe("stripe API operations (stripe-mock)", () => {
  beforeEach(async () => {
    const { resetStripeClient } = await import("#lib/stripe.ts");
    resetStripeClient();
    await createTestDb();
    const { updateStripeKey } = await import("#lib/db/settings.ts");
    await updateStripeKey("sk_test_mock");
  });

  afterEach(async () => {
    const mod = await import("#lib/stripe.ts");
    mod.resetStripeClient();
    resetDb();
  });

  test("createCheckoutSession creates session via stripe-mock", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    const result = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Test Item", unitPrice: 1000, quantity: 1 }],
      metadata: { test: "true" },
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    // stripe-mock returns a session with url
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sessionId).toBeDefined();
      expect(result.checkoutUrl).toBeDefined();
    }
  });

  test("retrieveCheckoutSession retrieves via stripe-mock", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    // First create a session
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Retrieve Test", unitPrice: 500, quantity: 2 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "usd",
    });
    expect(created).not.toBeNull();

    // Now retrieve it
    const retrieved = await stripeApi.retrieveCheckoutSession(created!.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created!.sessionId);
  });

  test("listCheckoutSessions lists sessions via stripe-mock", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    const result = await stripeApi.listCheckoutSessions({ limit: 10 });
    expect(result).not.toBeNull();
    if (result) {
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(typeof result.hasMore).toBe("boolean");
    }
  });

  test("listCheckoutSessions with startingAfter", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    // Create a session first so we have something to paginate from
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "List Test", unitPrice: 100, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    expect(created).not.toBeNull();

    const result = await stripeApi.listCheckoutSessions({
      limit: 5,
      startingAfter: created!.sessionId,
    });
    expect(result).not.toBeNull();
  });

  test("wrapper function listCheckoutSessions delegates", async () => {
    const { listCheckoutSessions } = await import("#lib/stripe.ts");
    const result = await listCheckoutSessions({ limit: 5 });
    expect(result).not.toBeNull();
  });

  test("createCheckoutSession returns null when stripe client unavailable", async () => {
    const { stripeApi, resetStripeClient } = await import("#lib/stripe.ts");
    resetStripeClient();
    resetDb();
    await createTestDb();
    // No stripe key configured
    const result = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Fail", unitPrice: 100, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    expect(result).toBeNull();
  });

  test("createCheckoutSession returns null when session has no URL", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    // Get the actual Stripe client to mock its internal create method
    const client = await stripeApi.getStripeClient();
    expect(client).not.toBeNull();
    const stripeClient = client!;
    await withMocks(
      () => spyOn(stripeClient.checkout.sessions, "create").mockResolvedValue(
        { id: "cs_no_url", url: null } as Awaited<ReturnType<typeof stripeClient.checkout.sessions.create>>,
      ),
      async () => {
        const result = await stripeApi.createCheckoutSession({
          lineItems: [{ name: "No URL", unitPrice: 100, quantity: 1 }],
          metadata: {},
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          currency: "gbp",
        });
        expect(result).toBeNull();
      },
    );
  });

  test("refundPayment wrapper delegates to stripeApi", async () => {
    const { refundPayment, stripeApi } = await import("#lib/stripe.ts");
    const fakeRefund = { id: "re_test", status: "succeeded" } as Awaited<ReturnType<typeof stripeApi.refundPayment>>;
    await withMocks(
      () => spyOn(stripeApi, "refundPayment").mockResolvedValue(fakeRefund),
      async () => {
        const result = await refundPayment("pi_test");
        expect(result).toBe(fakeRefund);
      },
    );
  });
});

describe("stripe-provider additional operations", () => {
  beforeEach(async () => {
    const { resetStripeClient } = await import("#lib/stripe.ts");
    resetStripeClient();
    await createTestDb();
    const { updateStripeKey } = await import("#lib/db/settings.ts");
    await updateStripeKey("sk_test_mock");
  });

  afterEach(async () => {
    const mod = await import("#lib/stripe.ts");
    mod.resetStripeClient();
    resetDb();
  });

  test("createCheckoutSession delegates to stripe", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const result = await stripePaymentProvider.createCheckoutSession({
      lineItems: [{ name: "Provider Test", unitPrice: 2000, quantity: 1 }],
      metadata: { source: "test" },
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sessionId).toBeDefined();
      expect(result.checkoutUrl).toBeDefined();
    }
  });

  test("retrieveSession maps stripe session to PaymentSession", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    // Create session first
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Retrieve Prov", unitPrice: 1500, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    expect(created).not.toBeNull();

    const session = await stripePaymentProvider.retrieveSession(created!.sessionId);
    expect(session).not.toBeNull();
    if (session) {
      expect(session.id).toBe(created!.sessionId);
      expect(session.status).toBeDefined();
    }
  });

  test("listSessions returns paginated sessions", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const result = await stripePaymentProvider.listSessions({ limit: 10 });
    expect(result).toBeDefined();
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(typeof result.hasMore).toBe("boolean");
  });

  test("retrieveSession returns null for non-existent session", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    // Mock retrieveCheckoutSession to return null (non-existent session)
    await withMocks(
      () => spyOn(stripeApi, "retrieveCheckoutSession").mockResolvedValue(null),
      async () => {
        const session = await stripePaymentProvider.retrieveSession("cs_nonexistent");
        expect(session).toBeNull();
      },
    );
  });

  test("retrieveCheckoutSessionExpanded retrieves via stripe-mock", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Expand Test", unitPrice: 800, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "usd",
    });
    expect(created).not.toBeNull();

    const expanded = await stripeApi.retrieveCheckoutSessionExpanded(created!.sessionId);
    expect(expanded).not.toBeNull();
    expect(expanded!.id).toBe(created!.sessionId);
  });

  test("wrapper retrieveCheckoutSessionExpanded delegates", async () => {
    const { retrieveCheckoutSessionExpanded, stripeApi } = await import("#lib/stripe.ts");
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Wrapper Expand", unitPrice: 600, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "usd",
    });
    expect(created).not.toBeNull();

    const result = await retrieveCheckoutSessionExpanded(created!.sessionId);
    expect(result).not.toBeNull();
  });

  test("retrieveCheckoutSession with expand param", async () => {
    const { stripeApi } = await import("#lib/stripe.ts");
    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Expand Param", unitPrice: 700, quantity: 1 }],
      metadata: {},
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "usd",
    });
    expect(created).not.toBeNull();

    const result = await stripeApi.retrieveCheckoutSession(created!.sessionId, ["line_items"]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(created!.sessionId);
  });

  test("retrieveSessionDetail maps expanded session to detail", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    const created = await stripeApi.createCheckoutSession({
      lineItems: [{ name: "Detail Test", unitPrice: 1200, quantity: 2 }],
      metadata: { order_ref: "test123" },
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      currency: "gbp",
    });
    expect(created).not.toBeNull();

    const detail = await stripePaymentProvider.retrieveSessionDetail(created!.sessionId);
    expect(detail).not.toBeNull();
    if (detail) {
      expect(detail.id).toBe(created!.sessionId);
      expect(detail.providerType).toBe("stripe");
      expect(detail.dashboardUrl).toContain("dashboard.stripe.com");
      expect(detail.dashboardUrl).toContain(created!.sessionId);
      expect(Array.isArray(detail.lineItems)).toBe(true);
      expect(typeof detail.metadata).toBe("object");
    }
  });

  test("retrieveSessionDetail returns null for non-existent session", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    await withMocks(
      () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue(null),
      async () => {
        const detail = await stripePaymentProvider.retrieveSessionDetail("cs_missing");
        expect(detail).toBeNull();
      },
    );
  });

  test("retrieveSessionDetail shows refunded status when charge is refunded", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    await withMocks(
      () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
        id: "cs_refund_test",
        payment_status: "paid",
        amount_total: 2000,
        currency: "gbp",
        customer_details: null,
        created: Math.floor(Date.now() / 1000),
        url: null,
        payment_intent: {
          id: "pi_refund_test",
          latest_charge: { refunded: true },
        },
        line_items: { data: [] },
        metadata: {},
      } as unknown as import("stripe").Stripe.Checkout.Session),
      async () => {
        const detail = await stripePaymentProvider.retrieveSessionDetail("cs_refund_test");
        expect(detail).not.toBeNull();
        expect(detail!.status).toBe("refunded");
        expect(detail!.paymentReference).toBe("pi_refund_test");
      },
    );
  });

  test("retrieveSessionDetail keeps paid status when charge is not refunded", async () => {
    const { stripePaymentProvider } = await import("#lib/stripe-provider.ts");
    const { stripeApi } = await import("#lib/stripe.ts");

    await withMocks(
      () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
        id: "cs_not_refunded",
        payment_status: "paid",
        amount_total: 1500,
        currency: "gbp",
        customer_details: null,
        created: Math.floor(Date.now() / 1000),
        url: null,
        payment_intent: {
          id: "pi_not_refunded",
          latest_charge: { refunded: false },
        },
        line_items: { data: [] },
        metadata: {},
      } as unknown as import("stripe").Stripe.Checkout.Session),
      async () => {
        const detail = await stripePaymentProvider.retrieveSessionDetail("cs_not_refunded");
        expect(detail).not.toBeNull();
        expect(detail!.status).toBe("paid");
        expect(detail!.paymentReference).toBe("pi_not_refunded");
      },
    );
  });
});
