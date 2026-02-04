import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import {
  sendWebhook,
  type WebhookPayload,
} from "#lib/webhook.ts";

describe("webhook", () => {
  // deno-lint-ignore no-explicit-any
  let fetchSpy: any;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  describe("sendWebhook", () => {
    test("sends POST request with correct payload", async () => {
      const payload: WebhookPayload = {
        event_type: "order.completed",
        provider_session_id: "cs_test_123",
        currency: "GBP",
        line_items: [
          { sku: "PROD-1", name: "Test Product", unit_price: 1000, quantity: 1 },
        ],
        timestamp: new Date().toISOString(),
      };

      await sendWebhook("https://example.com/webhook", payload);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://example.com/webhook");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(options.body as string) as WebhookPayload;
      expect(body.event_type).toBe("order.completed");
      expect(body.provider_session_id).toBe("cs_test_123");
      expect(body.line_items).toHaveLength(1);
    });

    test("does not throw on fetch error", async () => {
      fetchSpy.mockRejectedValue(new Error("Network error"));

      const payload: WebhookPayload = {
        event_type: "order.completed",
        provider_session_id: "cs_test_456",
        currency: "GBP",
        line_items: [
          { sku: "PROD-1", name: "Test Product", unit_price: 500, quantity: 2 },
        ],
        timestamp: new Date().toISOString(),
      };

      // Should not throw
      await sendWebhook("https://example.com/webhook", payload);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
