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
