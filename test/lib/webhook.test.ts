import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import {
  logAndNotifyOrder,
  sendWebhook,
  signWebhookPayload,
  type WebhookPayload,
} from "#lib/webhook.ts";
import { computeHmacSha256, hmacToHex } from "#lib/payment-crypto.ts";
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

      const body = JSON.parse(options.body as string) as WebhookPayload;
      expect(body.event_type).toBe("order.completed");
      expect(body.provider_session_id).toBe("cs_test_123");
      expect(body.line_items).toHaveLength(1);
    });

    test("does not include signature header when no secret provided", async () => {
      const payload: WebhookPayload = {
        event_type: "order.completed",
        provider_session_id: "cs_no_sig",
        currency: "GBP",
        line_items: [],
        timestamp: new Date().toISOString(),
      };

      await sendWebhook("https://example.com/webhook", payload);

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("includes HMAC signature header when secret is provided", async () => {
      const payload: WebhookPayload = {
        event_type: "order.completed",
        provider_session_id: "cs_signed",
        currency: "GBP",
        line_items: [
          { sku: "PROD-1", name: "Widget", unit_price: 500, quantity: 2 },
        ],
        timestamp: new Date().toISOString(),
      };

      await sendWebhook("https://example.com/webhook", payload, "test_secret_key");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Webhook-Signature"]).toBeDefined();
      expect(headers["X-Webhook-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
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

  describe("signWebhookPayload", () => {
    test("produces signature in t=<ts>,v1=<hex> format", async () => {
      const body = JSON.stringify({ test: true });
      const { signature, timestamp } = await signWebhookPayload(body, "secret123");

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(typeof timestamp).toBe("number");
      expect(timestamp).toBeGreaterThan(0);
    });

    test("signature is verifiable with the same secret", async () => {
      const secret = "my_webhook_secret";
      const body = '{"event_type":"order.completed"}';
      const { signature } = await signWebhookPayload(body, secret);

      // Parse the signature
      const parts = signature.split(",");
      const ts = parts[0]!.split("=")[1]!;
      const v1 = parts[1]!.split("=")[1]!;

      // Recompute
      const signedPayload = `${ts}.${body}`;
      const expected = hmacToHex(await computeHmacSha256(signedPayload, secret));
      expect(v1).toBe(expected);
    });

    test("different secrets produce different signatures", async () => {
      const body = '{"data":"same"}';
      const { signature: sig1 } = await signWebhookPayload(body, "secret_a");
      const { signature: sig2 } = await signWebhookPayload(body, "secret_b");

      const v1_1 = sig1.split(",")[1]!;
      const v1_2 = sig2.split(",")[1]!;
      expect(v1_1).not.toBe(v1_2);
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

    test("sends signed webhook when secret is provided", async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return Promise.resolve(new Response("ok"));
      }) as typeof globalThis.fetch;

      try {
        await logAndNotifyOrder(
          "sess_signed",
          [{ sku: "SKU-1", name: "Widget", unit_price: 1000, quantity: 1 }],
          "GBP",
          "https://example.com/hook",
          "webhook_signing_secret",
        );

        expect(capturedHeaders["X-Webhook-Signature"]).toBeDefined();
        expect(capturedHeaders["X-Webhook-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
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
