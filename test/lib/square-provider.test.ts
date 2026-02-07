import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import { squarePaymentProvider } from "#lib/square-provider.ts";
import { squareApi } from "#lib/square.ts";
import { createTestDb, resetDb, withMocks } from "#test-utils";

describe("square-provider", () => {
  beforeEach(async () => {
    await createTestDb();
    Deno.env.set("ALLOWED_DOMAIN", "example.com");
  });

  afterEach(() => {
    resetDb();
    Deno.env.set("ALLOWED_DOMAIN", "localhost");
  });

  describe("setupWebhookEndpoint", () => {
    test("returns failure since Square webhooks are manual", async () => {
      const result = await squarePaymentProvider.setupWebhookEndpoint(
        "key",
        "https://example.com/webhook",
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Square Developer Dashboard");
      }
    });
  });

  describe("retrieveSessionDetail", () => {
    test("returns null when order not found", async () => {
      await withMocks(
        () => spyOn(squareApi, "retrieveOrder").mockResolvedValue(null),
        async () => {
          const result = await squarePaymentProvider.retrieveSessionDetail("nonexistent");
          expect(result).toBe(null);
        },
      );
    });

    test("returns detail with dashboard URL and provider type", async () => {
      await withMocks(
        () => spyOn(squareApi, "retrieveOrder").mockResolvedValue({
          id: "order_abc",
          state: "COMPLETED",
          tenders: [{ paymentId: "pay_123" }],
          metadata: { key: "value" },
        }),
        async () => {
          const result = await squarePaymentProvider.retrieveSessionDetail("order_abc");
          expect(result).not.toBe(null);
          expect(result!.id).toBe("order_abc");
          expect(result!.status).toBe("COMPLETED");
          expect(result!.providerType).toBe("square");
          expect(result!.dashboardUrl).toContain("squareup.com");
          expect(result!.dashboardUrl).toContain("order_abc");
          expect(result!.paymentReference).toBe("pay_123");
          expect(result!.metadata).toEqual({ key: "value" });
          expect(result!.lineItems).toEqual([]);
        },
      );
    });

    test("handles order without tenders or metadata", async () => {
      await withMocks(
        () => spyOn(squareApi, "retrieveOrder").mockResolvedValue({
          id: "order_xyz",
          state: "OPEN",
        }),
        async () => {
          const result = await squarePaymentProvider.retrieveSessionDetail("order_xyz");
          expect(result).not.toBe(null);
          expect(result!.paymentReference).toBe(null);
          expect(result!.metadata).toEqual({});
        },
      );
    });

    test("falls back to sessionId when order.id is undefined", async () => {
      await withMocks(
        () => spyOn(squareApi, "retrieveOrder").mockResolvedValue({
          state: "OPEN",
        }),
        async () => {
          const result = await squarePaymentProvider.retrieveSessionDetail("fallback_id");
          expect(result).not.toBe(null);
          expect(result!.dashboardUrl).toContain("fallback_id");
        },
      );
    });
  });
});

describe("square-provider additional operations", () => {
  beforeEach(async () => {
    const { resetSquareClient } = await import("#lib/square.ts");
    resetSquareClient();
    await createTestDb();
    const { updateSquareAccessToken, updateSquareLocationId } = await import("#lib/db/settings.ts");
    await updateSquareAccessToken("EAAAl_test_mock");
    await updateSquareLocationId("LOC_PROV_123");
  });

  afterEach(async () => {
    const mod = await import("#lib/square.ts");
    mod.resetSquareClient();
    resetDb();
  });

  test("createCheckoutSession delegates to square", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const { squareApi } = await import("#lib/square.ts");

    await withMocks(
      () => spyOn(squareApi, "createCheckoutSession").mockResolvedValue({
        sessionId: "sq_sess_1",
        checkoutUrl: "https://square.link/prov",
      }),
      async () => {
        const result = await squarePaymentProvider.createCheckoutSession({
          lineItems: [{ name: "Prov Item", unitPrice: 500, quantity: 1 }],
          metadata: {},
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          currency: "GBP",
        });
        expect(result).not.toBeNull();
        expect(result!.sessionId).toBe("sq_sess_1");
      },
    );
  });

  test("setupWebhookEndpoint returns manual config error", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const result = await squarePaymentProvider.setupWebhookEndpoint(
      "key",
      "https://example.com/webhook",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("manually");
    }
  });

  test("retrieveSession maps square order to PaymentSession", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const { squareApi } = await import("#lib/square.ts");

    await withMocks(
      () => spyOn(squareApi, "retrieveOrder").mockResolvedValue({
        id: "order_prov_ret",
        state: "COMPLETED",
      }),
      async () => {
        const session = await squarePaymentProvider.retrieveSession("order_prov_ret");
        expect(session).not.toBeNull();
        expect(session!.id).toBe("order_prov_ret");
        expect(session!.status).toBe("COMPLETED");
      },
    );
  });

  test("retrieveSession returns null for missing order", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const { squareApi } = await import("#lib/square.ts");

    await withMocks(
      () => spyOn(squareApi, "retrieveOrder").mockResolvedValue(null),
      async () => {
        const session = await squarePaymentProvider.retrieveSession("order_missing");
        expect(session).toBeNull();
      },
    );
  });

  test("listSessions returns paginated sessions", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const { squareApi } = await import("#lib/square.ts");

    await withMocks(
      () => spyOn(squareApi, "searchOrders").mockResolvedValue({
        orders: [
          { id: "order_1", state: "COMPLETED" },
          { id: "order_2", state: "OPEN" },
        ],
        hasMore: true,
        cursor: "next_page",
      }),
      async () => {
        const result = await squarePaymentProvider.listSessions({ limit: 10 });
        expect(result.sessions.length).toBe(2);
        expect(result.hasMore).toBe(true);
        expect(result.sessions[0]!.id).toBe("order_1");
      },
    );
  });

  test("toPaymentSession maps order with no id/state to defaults", async () => {
    const { squarePaymentProvider } = await import("#lib/square-provider.ts");
    const { squareApi } = await import("#lib/square.ts");

    await withMocks(
      () => spyOn(squareApi, "retrieveOrder").mockResolvedValue({
        id: undefined,
        state: undefined,
      }),
      async () => {
        const session = await squarePaymentProvider.retrieveSession("any_id");
        expect(session).not.toBeNull();
        expect(session!.id).toBe("");
        expect(session!.status).toBe("UNKNOWN");
      },
    );
  });
});

describe("square-provider (webhook event types and refund reference)", () => {
  test("checkoutExpiredEventType is defined", async () => {
    const { squarePaymentProvider: provider } = await import("#lib/square-provider.ts");
    expect(provider.checkoutExpiredEventType).toBe("order.updated");
  });

  test("refundEventType is defined", async () => {
    const { squarePaymentProvider: provider } = await import("#lib/square-provider.ts");
    expect(provider.refundEventType).toBe("refund.updated");
  });

  test("getRefundReference extracts order_id", async () => {
    const { squarePaymentProvider: provider } = await import("#lib/square-provider.ts");
    const event = { id: "evt_1", type: "refund.updated", data: { object: { order_id: "order_123" } } };
    expect(await provider.getRefundReference(event)).toBe("order_123");
  });

  test("getRefundReference returns null when no order_id", async () => {
    const { squarePaymentProvider: provider } = await import("#lib/square-provider.ts");
    const event = { id: "evt_1", type: "refund.updated", data: { object: { payment_id: "pay_456" } } };
    expect(await provider.getRefundReference(event)).toBeNull();
  });
});
