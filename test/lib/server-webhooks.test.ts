import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import { handleRequest } from "#routes";
import { getDb } from "#lib/db/client.ts";
import { constructTestWebhookEvent, stripeApi } from "#lib/stripe.ts";
import { setStripeWebhookConfig } from "#lib/db/settings.ts";
import {
  createTestDbWithSetup,
  createTestProduct,
  mockWebhookRequest,
  resetDb,
  setupStripe,
  withMocks,
} from "#test-utils";
import { reserveStock, confirmReservation } from "#lib/db/reservations.ts";

/** Webhook signing secret for tests */
const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_webhook_tests";

/** Setup Stripe with webhook secret */
const setupStripeWithWebhook = async (): Promise<void> => {
  await setupStripe();
  await setStripeWebhookConfig({ secret: TEST_WEBHOOK_SECRET, endpointId: "we_test_123" });
};

/** Create a signed webhook request for a Stripe event */
const signedWebhookRequest = async (
  event: { id: string; type: string; data: { object: Record<string, unknown> } },
): Promise<Request> => {
  const { payload, signature } = await constructTestWebhookEvent(
    event as Parameters<typeof constructTestWebhookEvent>[0],
    TEST_WEBHOOK_SECRET,
  );
  return new Request("http://localhost/payment/webhook", {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
};

describe("server (webhooks)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("POST /payment/webhook", () => {
    test("returns 400 when no payment provider configured", async () => {
      const response = await handleRequest(
        mockWebhookRequest(
          { type: "checkout.session.completed" },
          { "stripe-signature": "sig_test" },
        ),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("not configured");
    });

    test("returns 400 when signature header is missing", async () => {
      await setupStripeWithWebhook();

      const response = await handleRequest(
        new Request("http://localhost/payment/webhook", {
          method: "POST",
          headers: {
            host: "localhost",
            "content-type": "application/json",
          },
          body: JSON.stringify({ type: "test" }),
        }),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Missing signature");
    });

    test("returns 400 when signature verification fails", async () => {
      await setupStripeWithWebhook();

      const response = await handleRequest(
        mockWebhookRequest(
          { type: "checkout.session.completed" },
          { "stripe-signature": "t=12345,v1=bad_signature_value" },
        ),
      );
      expect(response.status).toBe(400);
    });

    test("confirms reservations on checkout completed", async () => {
      await setupStripeWithWebhook();
      const product = await createTestProduct({ stock: 10 });
      const sessionId = "cs_test_completed";
      await reserveStock(product.id, 2, sessionId);

      const request = await signedWebhookRequest({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { id: sessionId } },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.processed).toBe(true);
      expect(data.confirmed).toBe(1);

      // Verify reservation status changed to confirmed
      const result = await getDb().execute({
        sql: "SELECT status FROM stock_reservations WHERE provider_session_id = ?",
        args: [sessionId],
      });
      expect(result.rows[0]?.status).toBe("confirmed");
    });

    test("handles duplicate checkout completed idempotently", async () => {
      await setupStripeWithWebhook();
      const product = await createTestProduct({ stock: 10 });
      const sessionId = "cs_test_dupe";
      await reserveStock(product.id, 1, sessionId);

      // First call
      const request1 = await signedWebhookRequest({
        id: "evt_2",
        type: "checkout.session.completed",
        data: { object: { id: sessionId } },
      });
      const response1 = await handleRequest(request1);
      expect(response1.status).toBe(200);
      const data1 = await response1.json();
      expect(data1.processed).toBe(true);

      // Second call (duplicate) - should be idempotent
      const request2 = await signedWebhookRequest({
        id: "evt_2b",
        type: "checkout.session.completed",
        data: { object: { id: sessionId } },
      });
      const response2 = await handleRequest(request2);
      expect(response2.status).toBe(200);
      const data2 = await response2.json();
      expect(data2.already_processed).toBe(true);
    });

    test("expires reservations on checkout.session.expired", async () => {
      await setupStripeWithWebhook();
      const product = await createTestProduct({ stock: 10 });
      const sessionId = "cs_test_expired";
      await reserveStock(product.id, 3, sessionId);

      const request = await signedWebhookRequest({
        id: "evt_3",
        type: "checkout.session.expired",
        data: { object: { id: sessionId } },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.processed).toBe(true);
      expect(data.expired).toBe(1);

      // Verify reservation status changed to expired
      const result = await getDb().execute({
        sql: "SELECT status FROM stock_reservations WHERE provider_session_id = ?",
        args: [sessionId],
      });
      expect(result.rows[0]?.status).toBe("expired");
    });

    test("restocks on charge.refunded", async () => {
      await setupStripeWithWebhook();
      const product = await createTestProduct({ stock: 10 });
      const checkoutSessionId = "cs_test_refund_session";
      const paymentIntentId = "pi_test_refund_intent";
      await reserveStock(product.id, 2, checkoutSessionId);
      await confirmReservation(checkoutSessionId);

      await withMocks(
        () => spyOn(stripeApi, "lookupSessionByPaymentIntent")
          .mockResolvedValue(checkoutSessionId),
        async (mocks) => {
          const request = await signedWebhookRequest({
            id: "evt_4",
            type: "charge.refunded",
            data: { object: { payment_intent: paymentIntentId } },
          });

          const response = await handleRequest(request);
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.processed).toBe(true);
          expect(data.restocked).toBe(1);
          expect(mocks).toHaveBeenCalledWith(paymentIntentId);

          // Verify reservation status changed from confirmed to expired
          const result = await getDb().execute({
            sql: "SELECT status FROM stock_reservations WHERE provider_session_id = ?",
            args: [checkoutSessionId],
          });
          expect(result.rows[0]?.status).toBe("expired");
        },
      );
    });

    test("acknowledges charge.refunded when session lookup fails", async () => {
      await setupStripeWithWebhook();

      await withMocks(
        () => spyOn(stripeApi, "lookupSessionByPaymentIntent")
          .mockResolvedValue(null),
        async () => {
          const request = await signedWebhookRequest({
            id: "evt_4b",
            type: "charge.refunded",
            data: { object: { payment_intent: "pi_test_unknown" } },
          });

          const response = await handleRequest(request);
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.received).toBe(true);
          expect(data.processed).toBeUndefined();
        },
      );
    });

    test("acknowledges unhandled event types", async () => {
      await setupStripeWithWebhook();

      const request = await signedWebhookRequest({
        id: "evt_5",
        type: "some.other.event",
        data: { object: { id: "test" } },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.received).toBe(true);
      expect(data.processed).toBeUndefined();
    });

    test("acknowledges checkout completed with missing session ID", async () => {
      await setupStripeWithWebhook();

      const request = await signedWebhookRequest({
        id: "evt_6",
        type: "checkout.session.completed",
        data: { object: {} },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.received).toBe(true);
    });

    test("acknowledges charge.refunded with missing payment_intent", async () => {
      await setupStripeWithWebhook();

      const request = await signedWebhookRequest({
        id: "evt_refund_no_pi",
        type: "charge.refunded",
        data: { object: {} },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.received).toBe(true);
    });

    test("acknowledges checkout.session.expired with missing session ID", async () => {
      await setupStripeWithWebhook();

      const request = await signedWebhookRequest({
        id: "evt_expired_no_id",
        type: "checkout.session.expired",
        data: { object: {} },
      });

      const response = await handleRequest(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.received).toBe(true);
    });
  });

  describe("buildLineItems edge cases", () => {
    const BUILD_LINE_ITEMS_SECRET = "whsec_test_build_line_items";

    beforeEach(async () => {
      await setupStripe();
      await setStripeWebhookConfig({ secret: BUILD_LINE_ITEMS_SECRET, endpointId: "we_test_bli" });
    });

    test("handles completed session with no reservations (empty line items)", async () => {
      const { payload, signature } = await constructTestWebhookEvent(
        {
          id: "evt_no_reservations",
          type: "checkout.session.completed",
          data: { object: { id: "sess_no_reservations" } },
        } as Parameters<typeof constructTestWebhookEvent>[0],
        BUILD_LINE_ITEMS_SECRET,
      );

      const response = await handleRequest(
        new Request("http://localhost/payment/webhook", {
          method: "POST",
          headers: {
            host: "localhost",
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          body: payload,
        }),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.processed).toBe(true);
      expect(data.confirmed).toBe(0);
    });

    test("handles product deleted after reservation (product map miss)", async () => {
      await getDb().execute("PRAGMA foreign_keys = OFF");
      await getDb().execute({
        sql: "INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created) VALUES (?, ?, ?, ?, ?)",
        args: [99999, 1, "sess_deleted_product", "pending", new Date().toISOString()],
      });
      await getDb().execute("PRAGMA foreign_keys = ON");

      const { payload, signature } = await constructTestWebhookEvent(
        {
          id: "evt_deleted_product",
          type: "checkout.session.completed",
          data: { object: { id: "sess_deleted_product" } },
        } as Parameters<typeof constructTestWebhookEvent>[0],
        BUILD_LINE_ITEMS_SECRET,
      );

      const response = await handleRequest(
        new Request("http://localhost/payment/webhook", {
          method: "POST",
          headers: {
            host: "localhost",
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          body: payload,
        }),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.processed).toBe(true);
    });
  });
});
