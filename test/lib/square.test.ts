import { afterEach, beforeEach, describe, expect, jest, test, spyOn } from "#test-compat";
import {
  constructTestWebhookEvent,
  getSquareClient,
  resetSquareClient,
  retrievePayment,
  squareApi,
  verifyWebhookSignature,
} from "#lib/square.ts";
import { squarePaymentProvider } from "#lib/square-provider.ts";
import type { WebhookEvent } from "#lib/payments.ts";
import {
  updateSquareAccessToken,
  updateSquareWebhookSignatureKey,
} from "#lib/db/settings.ts";
import { createTestDb, resetDb, withMocks } from "#test-utils";

/** Create a mock Square SDK client with spyable methods */
const createMockClient = () => {
  const paymentsGet = jest.fn();
  const refundsRefundPayment = jest.fn();
  const ordersSearch = jest.fn();

  return {
    client: {
      payments: { get: paymentsGet },
      refunds: { refundPayment: refundsRefundPayment },
      orders: { search: ordersSearch },
    },
    paymentsGet,
    refundsRefundPayment,
    ordersSearch,
  };
};

describe("square", () => {
  beforeEach(async () => {
    resetSquareClient();
    await createTestDb();
  });

  afterEach(() => {
    resetSquareClient();
    resetDb();
  });

  describe("getSquareClient", () => {
    test("returns null when access token not set", async () => {
      const client = await getSquareClient();
      expect(client).toBeNull();
    });

    test("returns client when access token is set in database", async () => {
      await updateSquareAccessToken("EAAAl_test_123");
      const client = await getSquareClient();
      expect(client).not.toBeNull();
    });

    test("returns cached client on second call with same token", async () => {
      await updateSquareAccessToken("EAAAl_cache_test");
      const client1 = await getSquareClient();
      expect(client1).not.toBeNull();

      // Second call with same token should use cached path
      const client2 = await getSquareClient();
      expect(client2).not.toBeNull();
    });
  });

  describe("resetSquareClient", () => {
    test("resets client state after token removed from db", async () => {
      await updateSquareAccessToken("EAAAl_test_123");
      const client1 = await getSquareClient();
      expect(client1).not.toBeNull();

      resetSquareClient();
      resetDb();
      await createTestDb();

      const client2 = await getSquareClient();
      expect(client2).toBeNull();
    });
  });

  describe("retrievePayment", () => {
    test("returns null when access token not set", async () => {
      const result = await squareApi.retrievePayment("pay_123");
      expect(result).toBeNull();
    });

    test("returns null when SDK returns no payment", async () => {
      const { client, paymentsGet } = createMockClient();
      paymentsGet.mockResolvedValue({ payment: null });

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await squareApi.retrievePayment("pay_missing");
          expect(result).toBeNull();
          expect(paymentsGet.mock.calls[0]![0]).toEqual({ paymentId: "pay_missing" });
        },
      );
    });

    test("maps payment fields correctly from SDK response", async () => {
      const { client, paymentsGet } = createMockClient();
      paymentsGet.mockResolvedValue({
        payment: {
          id: "pay_full",
          status: "COMPLETED",
          orderId: "order_999",
          amountMoney: {
            amount: BigInt(5000),
            currency: "GBP",
          },
        },
      });

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await squareApi.retrievePayment("pay_full");
          expect(result).not.toBeNull();
          expect(result!.id).toBe("pay_full");
          expect(result!.status).toBe("COMPLETED");
          expect(result!.orderId).toBe("order_999");
          expect(result!.amountMoney!.amount).toBe(BigInt(5000));
          expect(result!.amountMoney!.currency).toBe("GBP");
        },
      );
    });

  });

  describe("retrievePayment wrapper export", () => {
    test("delegates to squareApi.retrievePayment", async () => {
      const { client, paymentsGet } = createMockClient();
      paymentsGet.mockResolvedValue({
        payment: {
          id: "pay_wrapper",
          status: "COMPLETED",
          orderId: "order_wrapper",
          amountMoney: { amount: BigInt(1000), currency: "USD" },
        },
      });

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await retrievePayment("pay_wrapper");
          expect(result).not.toBeNull();
          expect(result!.id).toBe("pay_wrapper");
          expect(result!.status).toBe("COMPLETED");
          expect(paymentsGet.mock.calls[0]![0]).toEqual({ paymentId: "pay_wrapper" });
        },
      );
    });
  });

  describe("refundPayment", () => {
    test("returns false when access token not set", async () => {
      const result = await squareApi.refundPayment("pay_123");
      expect(result).toBe(false);
    });

    test("returns false when payment retrieval returns null", async () => {
      await withMocks(
        () =>
          spyOn(squareApi, "retrievePayment")
            .mockResolvedValue(null),
        async () => {
          const result = await squareApi.refundPayment("pay_123");
          expect(result).toBe(false);
        },
      );
    });

    test("calls SDK refund with correct amount from payment", async () => {
      const { client, paymentsGet, refundsRefundPayment } = createMockClient();
      paymentsGet.mockResolvedValue({
        payment: {
          id: "pay_refund_me",
          status: "COMPLETED",
          orderId: "order_refund",
          amountMoney: { amount: BigInt(4200), currency: "USD" },
        },
      });
      refundsRefundPayment.mockResolvedValue({
        refund: { id: "refund_123", status: "PENDING" },
      });

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await squareApi.refundPayment("pay_refund_me");
          expect(result).toBe(true);

          // Verify payments.get was called to fetch amount
          expect(paymentsGet.mock.calls[0]![0]).toEqual({ paymentId: "pay_refund_me" });

          // Verify refund was called with correct amount and payment ID
          // deno-lint-ignore no-explicit-any
          const refundArgs = refundsRefundPayment.mock.calls[0]![0] as any;
          expect(refundArgs.paymentId).toBe("pay_refund_me");
          expect(refundArgs.amountMoney.amount).toBe(BigInt(4200));
          expect(refundArgs.amountMoney.currency).toBe("USD");
          expect(typeof refundArgs.idempotencyKey).toBe("string");
          expect(refundArgs.idempotencyKey.length).toBeGreaterThan(0);
        },
      );
    });

    test("returns false when refund SDK call throws", async () => {
      const { client, paymentsGet, refundsRefundPayment } = createMockClient();
      paymentsGet.mockResolvedValue({
        payment: {
          id: "pay_fail",
          status: "COMPLETED",
          orderId: "order_fail",
          amountMoney: { amount: BigInt(1000), currency: "GBP" },
        },
      });
      refundsRefundPayment.mockRejectedValue(new Error("Square API error"));

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await squareApi.refundPayment("pay_fail");
          expect(result).toBe(false);
        },
      );
    });
  });

  describe("verifyWebhookSignature", () => {
    const TEST_SECRET = "square_test_signature_key";
    const TEST_NOTIFICATION_URL = "https://example.com/payment/webhook";

    beforeEach(async () => {
      await updateSquareWebhookSignatureKey(TEST_SECRET);
    });

    test("returns error when webhook signature key not configured", async () => {
      await resetDb();
      await createTestDb();
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "somesig",
        TEST_NOTIFICATION_URL,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Webhook signature key not configured");
      }
    });

    test("returns error when notification URL not provided", async () => {
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "somesig",
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Notification URL required for verification");
      }
    });

    test("returns error for invalid signature", async () => {
      const result = await verifyWebhookSignature(
        '{"test": true}',
        "invalidsignature",
        TEST_NOTIFICATION_URL,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Signature verification failed");
      }
    });

    test("returns error for invalid JSON payload with valid signature", async () => {
      const payload = "not valid json {{{";
      const { signature } = await constructTestWebhookEvent(
        // We'll sign the raw payload by constructing manually
        { id: "dummy", type: "dummy", data: { object: {} } },
        TEST_SECRET,
        TEST_NOTIFICATION_URL,
      );

      // Generate correct signature for invalid JSON payload
      const signedPayload = TEST_NOTIFICATION_URL + payload;
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload),
      );
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

      // Use the underscore prefix to suppress unused var lint
      void signature;

      const result = await verifyWebhookSignature(
        payload,
        sigBase64,
        TEST_NOTIFICATION_URL,
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid JSON payload");
      }
    });

    test("verifies valid signature successfully", async () => {
      const event: WebhookEvent = {
        id: "evt_square_123",
        type: "payment.updated",
        data: {
          object: {
            id: "pay_123",
            status: "COMPLETED",
            order_id: "order_456",
          },
        },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        TEST_SECRET,
        TEST_NOTIFICATION_URL,
      );

      const result = await verifyWebhookSignature(
        payload,
        signature,
        TEST_NOTIFICATION_URL,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.event.id).toBe("evt_square_123");
        expect(result.event.type).toBe("payment.updated");
      }
    });
  });

  describe("constructTestWebhookEvent", () => {
    test("creates valid payload and signature pair", async () => {
      const secret = "square_test_construction";
      const notificationUrl = "https://example.com/payment/webhook";
      const event: WebhookEvent = {
        id: "evt_constructed",
        type: "payment.updated",
        data: {
          object: {
            id: "pay_123",
            status: "COMPLETED",
          },
        },
      };

      const { payload, signature } = await constructTestWebhookEvent(
        event,
        secret,
        notificationUrl,
      );

      // Verify payload is valid JSON matching input
      const parsed = JSON.parse(payload);
      expect(parsed.id).toBe("evt_constructed");
      expect(parsed.type).toBe("payment.updated");

      // Signature should be base64-encoded
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);

      // Signature should be verifiable with the same secret (stored in DB)
      await updateSquareWebhookSignatureKey(secret);
      const result = await verifyWebhookSignature(
        payload,
        signature,
        notificationUrl,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("squarePaymentProvider integration", () => {
    test("refundPayment delegates through SDK", async () => {
      const { client, paymentsGet, refundsRefundPayment } = createMockClient();
      paymentsGet.mockResolvedValue({
        payment: {
          id: "pay_prov_ref",
          status: "COMPLETED",
          orderId: "order_prov_ref",
          amountMoney: { amount: BigInt(2000), currency: "GBP" },
        },
      });
      refundsRefundPayment.mockResolvedValue({
        refund: { id: "refund_prov", status: "PENDING" },
      });

      await withMocks(
        () => spyOn(squareApi, "getSquareClient").mockResolvedValue(client),
        async () => {
          const result = await squarePaymentProvider.refundPayment("pay_prov_ref");
          expect(result).toBe(true);
        },
      );
    });

    test("verifyWebhookSignature delegates with notification URL", async () => {
      // Without a real key configured, verification should fail
      const result = await squarePaymentProvider.verifyWebhookSignature(
        '{"test": true}',
        "fakesig",
      );
      expect(result.valid).toBe(false);
    });
  });
});
