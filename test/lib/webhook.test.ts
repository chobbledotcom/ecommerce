import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import {
  logAndNotifyOrder,
  sendWebhook,
  type WebhookPayload,
} from "#lib/webhook.ts";
import {
  createTestDbWithSetup,
  resetDb,
} from "#test-utils";

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

  describe("logAndNotifyOrder with webhook", () => {
    beforeEach(async () => {
      await createTestDbWithSetup();
    });

    afterEach(() => {
      resetDb();
    });

    test("sends webhook when URL is provided", async () => {
      // Mock fetch to capture the webhook call
      const originalFetch = globalThis.fetch;
      let capturedUrl = "";
      let capturedBody = "";
      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = init?.body as string;
        return Promise.resolve(new Response("ok"));
      }) as typeof globalThis.fetch;

      try {
        await logAndNotifyOrder(
          "sess_test",
          [{ sku: "SKU-1", name: "Widget", unit_price: 1000, quantity: 2 }],
          "GBP",
          "https://example.com/hook",
        );

        expect(capturedUrl).toBe("https://example.com/hook");
        const body = JSON.parse(capturedBody);
        expect(body.event_type).toBe("order.completed");
        expect(body.provider_session_id).toBe("sess_test");
        expect(body.line_items.length).toBe(1);
        expect(body.currency).toBe("GBP");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("does not send webhook when URL is null", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = (() => {
        fetchCalled = true;
        return Promise.resolve(new Response("ok"));
      }) as typeof globalThis.fetch;

      try {
        await logAndNotifyOrder("sess_test2", [], "GBP", null);
        expect(fetchCalled).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("logs error when webhook fetch fails", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("Network error");
      }) as unknown as typeof globalThis.fetch;

      try {
        // Should not throw - errors are logged but not propagated
        await sendWebhook("https://example.com/hook", {
          event_type: "order.completed",
          provider_session_id: "sess_err",
          currency: "GBP",
          line_items: [],
          timestamp: new Date().toISOString(),
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
