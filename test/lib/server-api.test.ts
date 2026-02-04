import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import { handleRequest } from "#routes";
import { stripeApi } from "#lib/stripe.ts";
import {
  createTestDbWithSetup,
  createTestProduct,
  resetDb,
  setupStripe,
  withMocks,
} from "#test-utils";

/** Helper to create a JSON POST request to the API */
const apiPostRequest = (
  path: string,
  body: unknown,
): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("server (public API)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("GET /api/products", () => {
    test("returns empty array when no products exist", async () => {
      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: { host: "localhost" },
        }),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual([]);
    });

    test("returns active products with stock info", async () => {
      await createTestProduct({ name: "Widget", sku: "WDG-1", unitPrice: 1500, stock: 10 });
      await createTestProduct({ name: "Gadget", sku: "GDG-1", unitPrice: 2500, stock: -1 });

      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: { host: "localhost" },
        }),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.length).toBe(2);

      // Find gadget (unlimited stock)
      const gadget = data.find((p: { sku: string }) => p.sku === "GDG-1");
      expect(gadget.in_stock).toBe(true);
      expect(gadget.price_formatted).toBe("25.00");
      expect(gadget.stock).toBeUndefined(); // unlimited stock doesn't show count

      // Find widget (limited stock)
      const widget = data.find((p: { sku: string }) => p.sku === "WDG-1");
      expect(widget.stock).toBe(10);
      expect(widget.in_stock).toBe(true);
      expect(widget.price_formatted).toBe("15.00");
    });

    test("excludes inactive products", async () => {
      await createTestProduct({ name: "Active", sku: "ACT-1", active: 1 });
      await createTestProduct({ name: "Inactive", sku: "INA-1", active: 0 });

      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: { host: "localhost" },
        }),
      );
      const data = await response.json();
      expect(data.length).toBe(1);
      expect(data[0].sku).toBe("ACT-1");
    });

    test("returns JSON content type", async () => {
      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: { host: "localhost" },
        }),
      );
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("POST /api/checkout", () => {
    test("returns 503 when no payment provider configured", async () => {
      await createTestProduct({ sku: "SKU-1" });

      const response = await handleRequest(
        apiPostRequest("/api/checkout", {
          items: [{ sku: "SKU-1", quantity: 1 }],
          success_url: "https://shop.example.com/success",
          cancel_url: "https://shop.example.com/cancel",
        }),
      );
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toContain("not configured");
    });

    test("returns 400 for invalid JSON body", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            new Request("http://localhost/api/checkout", {
              method: "POST",
              headers: {
                host: "localhost",
                "content-type": "application/json",
              },
              body: "not json",
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("Invalid JSON");
        },
      );
    });

    test("returns 400 for missing items array", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("Invalid items");
        },
      );
    });

    test("returns 400 for empty items array", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("Invalid items");
        },
      );
    });

    test("returns 400 for invalid item shape", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: 123, quantity: "abc" }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
        },
      );
    });

    test("returns 400 for missing success_url or cancel_url", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "SKU-1", quantity: 1 }],
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("success_url");
        },
      );
    });

    test("returns 400 for unknown SKU", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "NONEXISTENT", quantity: 1 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("not found");
        },
      );
    });

    test("creates checkout session and returns URL on success", async () => {
      await setupStripe();
      await createTestProduct({ sku: "SHIRT-1", name: "T-Shirt", unitPrice: 2000, stock: 5 });

      await withMocks(
        () => spyOn(stripeApi, "createCheckoutSession").mockResolvedValue({
          sessionId: "cs_test_123",
          checkoutUrl: "https://checkout.stripe.com/pay",
        }),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "SHIRT-1", quantity: 2 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data.url).toBe("https://checkout.stripe.com/pay");
        },
      );
    });

    test("returns 409 for insufficient stock", async () => {
      await setupStripe();
      await createTestProduct({ sku: "LOW-1", name: "Low Stock", unitPrice: 1000, stock: 1 });

      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "LOW-1", quantity: 5 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(409);
          const data = await response.json();
          expect(data.error).toContain("Insufficient stock");
          expect(data.details[0].sku).toBe("LOW-1");
        },
      );
    });

    test("returns 502 when provider fails to create session", async () => {
      await setupStripe();
      await createTestProduct({ sku: "OK-1", name: "OK Product", unitPrice: 500, stock: 10 });

      await withMocks(
        () => spyOn(stripeApi, "createCheckoutSession").mockResolvedValue(null),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "OK-1", quantity: 1 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(502);
          const data = await response.json();
          expect(data.error).toContain("Failed to create checkout session");
        },
      );
    });

    test("returns 400 for quantity less than 1", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "SKU-1", quantity: 0 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
        },
      );
    });

    test("returns 400 for non-integer quantity", async () => {
      await setupStripe();
      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "SKU-1", quantity: 1.5 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
        },
      );
    });

    test("returns 400 for inactive product", async () => {
      await setupStripe();
      await createTestProduct({ sku: "DEAD-1", active: 0, stock: 10 });

      await withMocks(
        () => stripeCreateMock(),
        async () => {
          const response = await handleRequest(
            apiPostRequest("/api/checkout", {
              items: [{ sku: "DEAD-1", quantity: 1 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          );
          expect(response.status).toBe(400);
          const data = await response.json();
          expect(data.error).toContain("not found");
        },
      );
    });
  });

  describe("CORS and content type", () => {
    test("API POST with form-urlencoded is rejected", async () => {
      const response = await handleRequest(
        new Request("http://localhost/api/checkout", {
          method: "POST",
          headers: {
            host: "localhost",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "sku=test",
        }),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain("Invalid Content-Type");
    });

    test("OPTIONS preflight returns 204 for allowed origin", async () => {
      const { setSetting, CONFIG_KEYS } = await import("#lib/db/settings.ts");
      await setSetting(CONFIG_KEYS.ALLOWED_ORIGINS, "https://shop.example.com");

      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          method: "OPTIONS",
          headers: {
            host: "localhost",
            origin: "https://shop.example.com",
          },
        }),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://shop.example.com",
      );
    });

    test("OPTIONS preflight without allowed origin gets no CORS headers", async () => {
      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          method: "OPTIONS",
          headers: {
            host: "localhost",
            origin: "https://evil.example.com",
          },
        }),
      );
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });

    test("API GET response includes CORS headers for allowed origin", async () => {
      const { setSetting, CONFIG_KEYS } = await import("#lib/db/settings.ts");
      await setSetting(CONFIG_KEYS.ALLOWED_ORIGINS, "https://shop.example.com");

      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: {
            host: "localhost",
            origin: "https://shop.example.com",
          },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://shop.example.com",
      );
    });

    test("API GET response excludes CORS headers for disallowed origin", async () => {
      const response = await handleRequest(
        new Request("http://localhost/api/products", {
          headers: {
            host: "localhost",
            origin: "https://evil.example.com",
          },
        }),
      );
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});

/** Mock stripe checkout session creation - prevents real Stripe API call */
const stripeCreateMock = () =>
  spyOn(stripeApi, "createCheckoutSession").mockResolvedValue({
    sessionId: "cs_test_mock",
    checkoutUrl: "https://checkout.stripe.com/mock",
  });
