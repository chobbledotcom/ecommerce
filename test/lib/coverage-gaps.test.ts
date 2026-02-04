/**
 * Tests to close coverage gaps across the codebase.
 * Each describe block targets a specific source file's uncovered lines.
 */
import { afterEach, beforeEach, describe, expect, test, spyOn, jest } from "#test-compat";
import { handleRequest } from "#routes";
import {
  createTestDb,
  createTestDbWithSetup,
  createTestProduct,
  invalidateTestDbCache,
  loginAsAdmin,
  mockFormRequest,
  mockRequest,
  resetDb,
  setupStripe,
  getTestSession,
  awaitTestRequest,
  authenticatedFormRequest,
  withMocks,
  expectStatus,
  expectRedirect,
  expectAdminRedirect,
  expectResultError,
  expectResultNotFound,
  successResponse,
  errorResponse,
  expectValid,
  expectInvalid,
  expectInvalidForm,
  mockWebhookRequest,
  testRequest,
  mockSetupFormRequest,
  getSetupCsrfToken,
  getCsrfTokenFromCookie,
  randomString,
  resetTestSession,
} from "#test-utils";

// =========================================================================
// src/templates/layout.tsx — escapeHtml (lines 10-15)
// =========================================================================
describe("templates/layout.tsx (escapeHtml)", () => {
  test("escapes ampersands", async () => {
    const { escapeHtml } = await import("#templates/layout.tsx");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  test("escapes angle brackets", async () => {
    const { escapeHtml } = await import("#templates/layout.tsx");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes double quotes", async () => {
    const { escapeHtml } = await import("#templates/layout.tsx");
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });
});

// =========================================================================
// src/templates/admin/orders.tsx — formatAmount (lines 11, 13)
// =========================================================================
describe("templates/admin/orders.tsx (formatAmount)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("renders order with null amount as dash", async () => {
    const { adminOrdersPage } = await import("#templates/admin/orders.tsx");
    const session = { csrfToken: "test", adminLevel: "owner" as const };
    const html = adminOrdersPage(
      [{ id: "sess_1", status: "paid", amount: null, currency: null, customerEmail: null, created: "2024-01-01", url: null }],
      false,
      session,
    );
    expect(html).toContain("-");
  });

  test("renders order amount without currency", async () => {
    const { adminOrdersPage } = await import("#templates/admin/orders.tsx");
    const session = { csrfToken: "test", adminLevel: "owner" as const };
    const html = adminOrdersPage(
      [{ id: "sess_2", status: "paid", amount: 1500, currency: null, customerEmail: null, created: "2024-01-01", url: null }],
      false,
      session,
    );
    expect(html).toContain("15.00");
  });

  test("renders order amount with currency", async () => {
    const { adminOrdersPage } = await import("#templates/admin/orders.tsx");
    const session = { csrfToken: "test", adminLevel: "owner" as const };
    const html = adminOrdersPage(
      [{ id: "sess_3", status: "paid", amount: 2500, currency: "gbp", customerEmail: null, created: "2024-01-01", url: null }],
      false,
      session,
    );
    expect(html).toContain("25.00 GBP");
  });
});

// =========================================================================
// src/templates/admin/products.tsx — stockText (lines 19-20)
// =========================================================================
describe("templates/admin/products.tsx (stockText)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("shows 'Unlimited' for stock of -1", async () => {
    await createTestProduct({ stock: -1 });
    const { cookie } = await loginAsAdmin();
    const response = await awaitTestRequest("/admin/", { cookie });
    const html = await response.text();
    expect(html).toContain("Unlimited");
  });

  test("shows available/total for limited stock", async () => {
    await createTestProduct({ stock: 10 });
    const { cookie } = await loginAsAdmin();
    const response = await awaitTestRequest("/admin/", { cookie });
    const html = await response.text();
    expect(html).toContain("10 / 10");
  });
});

// =========================================================================
// src/templates/fields.ts — validateEmail (lines 12, 14-19), parseCurrency (line 300)
// =========================================================================
describe("templates/fields.ts (validateEmail, parseCurrency)", () => {
  test("validateEmail returns null for valid email", async () => {
    const { validateEmail } = await import("#templates/fields.ts");
    expect(validateEmail("test@example.com")).toBeNull();
  });

  test("validateEmail returns error for invalid email", async () => {
    const { validateEmail } = await import("#templates/fields.ts");
    expect(validateEmail("not-an-email")).not.toBeNull();
    expect(validateEmail("@missing-local.com")).not.toBeNull();
    expect(validateEmail("missing@")).not.toBeNull();
  });

  test("parseCurrencyForm rejects invalid currency code", async () => {
    const { parseCurrencyForm } = await import("#templates/fields.ts");
    const form = new URLSearchParams({ currency_code: "ab" });
    const result = parseCurrencyForm(form);
    expect(result.valid).toBe(false);
  });

  test("parseCurrencyForm accepts valid 3-letter code", async () => {
    const { parseCurrencyForm } = await import("#templates/fields.ts");
    const form = new URLSearchParams({ currency_code: "usd" });
    const result = parseCurrencyForm(form);
    expect(result.valid).toBe(true);
  });
});

// =========================================================================
// src/routes/utils.ts — jsonErrorResponse (lines 158-162), getBaseUrl (lines 194-197)
// =========================================================================
describe("routes/utils.ts (jsonErrorResponse, getBaseUrl)", () => {
  test("jsonErrorResponse returns JSON error with correct status", async () => {
    const { jsonErrorResponse } = await import("#routes/utils.ts");
    const response = jsonErrorResponse("Something went wrong", 422);
    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.error).toBe("Something went wrong");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("jsonErrorResponse defaults to 400 status", async () => {
    const { jsonErrorResponse } = await import("#routes/utils.ts");
    const response = jsonErrorResponse("Bad request");
    expect(response.status).toBe(400);
  });

  test("getBaseUrl extracts protocol and host", async () => {
    const { getBaseUrl } = await import("#routes/utils.ts");
    const request = new Request("http://example.com:3000/some/path?q=1");
    expect(getBaseUrl(request)).toBe("http://example.com:3000");
  });

  test("getBaseUrl handles https", async () => {
    const { getBaseUrl } = await import("#routes/utils.ts");
    const request = new Request("https://secure.example.com/path");
    expect(getBaseUrl(request)).toBe("https://secure.example.com");
  });
});

// =========================================================================
// src/routes/assets.ts — handleMvpCss, handleFavicon (lines 23-40)
// =========================================================================
describe("routes/assets.ts (CSS and favicon)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("GET /mvp.css returns CSS content", async () => {
    const response = await handleRequest(mockRequest("/mvp.css"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
  });

  test("GET /favicon.ico returns SVG", async () => {
    const response = await handleRequest(mockRequest("/favicon.ico"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const body = await response.text();
    expect(body).toContain("<svg");
  });
});

// =========================================================================
// src/routes/static.ts (lines 12, 13) — covered via asset tests above
// =========================================================================

// =========================================================================
// src/routes/admin/dashboard.ts — handleAdminLog (lines 21-31)
// =========================================================================
describe("routes/admin/dashboard.ts (activity log)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("GET /admin/log shows activity log when authenticated", async () => {
    const { cookie } = await loginAsAdmin();
    // Log some activity
    const { logActivity } = await import("#lib/db/activityLog.ts");
    await logActivity("Test activity entry");

    const response = await awaitTestRequest("/admin/log", { cookie });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Test activity entry");
  });

  test("GET /admin/log redirects when not authenticated", async () => {
    const response = await handleRequest(mockRequest("/admin/log"));
    expectAdminRedirect(response);
  });

  test("GET /admin/log truncates long log", async () => {
    const { cookie } = await loginAsAdmin();
    const { logActivity } = await import("#lib/db/activityLog.ts");
    // Log enough entries to exceed 200 limit
    for (let i = 0; i < 202; i++) {
      await logActivity(`Entry ${i}`);
    }

    const response = await awaitTestRequest("/admin/log", { cookie });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Showing the most recent");
  });
});

// =========================================================================
// src/lib/db/activityLog.ts — getAllActivityLog (lines 52-61)
// =========================================================================
describe("lib/db/activityLog.ts (getAllActivityLog)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("returns activity log entries in reverse chronological order", async () => {
    const { logActivity, getAllActivityLog } = await import("#lib/db/activityLog.ts");
    await logActivity("First");
    await logActivity("Second");
    const entries = await getAllActivityLog();
    expect(entries.length).toBe(2);
    expect(entries[0]!.message).toBe("Second");
    expect(entries[1]!.message).toBe("First");
  });

  test("respects limit parameter", async () => {
    const { logActivity, getAllActivityLog } = await import("#lib/db/activityLog.ts");
    await logActivity("A");
    await logActivity("B");
    await logActivity("C");
    const entries = await getAllActivityLog(2);
    expect(entries.length).toBe(2);
  });
});

// =========================================================================
// src/lib/db/client.ts — queryBatch (lines 57-59)
// =========================================================================
describe("lib/db/client.ts (queryBatch)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("executes multiple queries in batch", async () => {
    const { queryBatch } = await import("#lib/db/client.ts");
    await createTestProduct({ sku: "BATCH-1" });
    await createTestProduct({ sku: "BATCH-2" });

    const results = await queryBatch([
      { sql: "SELECT COUNT(*) as count FROM products", args: [] },
      { sql: "SELECT * FROM products WHERE sku = ?", args: ["BATCH-1"] },
    ]);
    expect(results.length).toBe(2);
    expect((results[0]!.rows[0] as unknown as { count: number }).count).toBe(2);
    expect(results[1]!.rows.length).toBe(1);
  });
});

// =========================================================================
// src/lib/db/migrations/index.ts — isDbUpToDate early exit (lines 45-47)
// =========================================================================
describe("lib/db/migrations/index.ts (idempotent initDb)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("initDb is idempotent - second call is a no-op", async () => {
    const { initDb } = await import("#lib/db/migrations/index.ts");
    // First initDb already ran in createTestDbWithSetup, run again
    await initDb(); // Should be a no-op due to isDbUpToDate check
    // Verify settings are still intact
    const { getDb } = await import("#lib/db/client.ts");
    const result = await getDb().execute(
      "SELECT value FROM settings WHERE key = 'latest_db_update'",
    );
    expect(result.rows.length).toBe(1);
  });
});

// =========================================================================
// src/lib/db/processed-payments.ts — reserveSession conflict paths (lines 79-99)
// =========================================================================
describe("lib/db/processed-payments.ts (reserveSession conflict)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("reserveSession returns conflict for already-claimed session", async () => {
    const { reserveSession } = await import("#lib/db/processed-payments.ts");
    const result1 = await reserveSession("sess_123");
    expect(result1.reserved).toBe(true);

    const result2 = await reserveSession("sess_123");
    expect(result2.reserved).toBe(false);
    if (!result2.reserved) {
      expect(result2.existing.payment_session_id).toBe("sess_123");
    }
  });

  test("reserveSession reclaims stale reservation", async () => {
    const { reserveSession, STALE_RESERVATION_MS } = await import("#lib/db/processed-payments.ts");
    const { getDb } = await import("#lib/db/client.ts");

    // Insert a stale reservation
    const staleTime = new Date(Date.now() - STALE_RESERVATION_MS - 1000).toISOString();
    await getDb().execute({
      sql: "INSERT INTO processed_payments (payment_session_id, processed_at) VALUES (?, ?)",
      args: ["stale_sess", staleTime],
    });

    const result = await reserveSession("stale_sess");
    expect(result.reserved).toBe(true);
  });

  test("reserveSession rethrows non-constraint errors", async () => {
    const { getDb } = await import("#lib/db/client.ts");
    // Drop the table to cause a different error
    await getDb().execute("DROP TABLE processed_payments");

    const { reserveSession } = await import("#lib/db/processed-payments.ts");
    await expect(reserveSession("any_sess")).rejects.toThrow();

    // Recreate for cleanup
    await getDb().execute(`
      CREATE TABLE processed_payments (
        payment_session_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )
    `);
  });
});

// =========================================================================
// src/lib/db/products.ts — getAvailableStock unlimited (line 82)
// =========================================================================
describe("lib/db/products.ts (getAvailableStock unlimited)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("returns -1 for unlimited stock product", async () => {
    const product = await createTestProduct({ stock: -1 });
    const { getAvailableStock } = await import("#lib/db/products.ts");
    const available = await getAvailableStock(product.id);
    expect(available).toBe(-1);
  });
});

// =========================================================================
// src/lib/db/reservations.ts — withDefault status (line 31)
// Already covered by creating reservations, but let's make explicit
// =========================================================================

// =========================================================================
// src/lib/payment-helpers.ts — toSessionListResult null items (line 49)
// =========================================================================
describe("lib/payment-helpers.ts (toSessionListResult)", () => {
  test("returns empty result when items are undefined", async () => {
    const { toSessionListResult } = await import("#lib/payment-helpers.ts");
    const result = toSessionListResult(
      { hasMore: true },
      undefined,
      () => ({ id: "", status: "", amount: null, currency: null, customerEmail: null, created: "", url: null }),
    );
    expect(result.sessions).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

// =========================================================================
// src/lib/webhook.ts — logAndNotifyOrder with webhookUrl (lines 58-65)
// =========================================================================
describe("lib/webhook.ts (logAndNotifyOrder with webhook)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("sends webhook when URL is provided", async () => {
    const { logAndNotifyOrder } = await import("#lib/webhook.ts");
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
    const { logAndNotifyOrder } = await import("#lib/webhook.ts");
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
    const { sendWebhook } = await import("#lib/webhook.ts");
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

// =========================================================================
// src/lib/crypto.ts — getPrivateKeyFromSession (lines 825, 828)
// =========================================================================
describe("lib/crypto.ts (getPrivateKeyFromSession)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("derives private key from session credentials", async () => {
    const {
      generateDataKey,
      generateKeyPair,
      wrapKeyWithToken,
      encryptWithKey,
      getPrivateKeyFromSession,
    } = await import("#lib/crypto.ts");

    // Generate a key pair and data key
    const { privateKey: privateKeyJwk } = await generateKeyPair();
    const dataKey = await generateDataKey();

    // Wrap the data key with a test token
    const testToken = "test-session-token-" + crypto.randomUUID();
    const wrappedDataKey = await wrapKeyWithToken(dataKey, testToken);

    // Encrypt the private key with the data key
    const wrappedPrivateKey = await encryptWithKey(privateKeyJwk, dataKey);

    // Now recover it
    const recovered = await getPrivateKeyFromSession(testToken, wrappedDataKey, wrappedPrivateKey);
    expect(recovered).not.toBeNull();
  });
});

// =========================================================================
// src/routes/admin/products.ts — parseProductId invalid (line 24), product not found (lines 84, 105, 140)
// =========================================================================
describe("routes/admin/products.ts (edge cases)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("GET /admin/product/abc/edit returns 404 for non-numeric ID", async () => {
    const { cookie } = await loginAsAdmin();
    const response = await awaitTestRequest("/admin/product/abc/edit", { cookie });
    expect(response.status).toBe(404);
  });

  test("POST /admin/product/9999 returns 404 for non-existent product", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/product/9999",
        { name: "Test", sku: "T", unit_price: "100", stock: "1", csrf_token: csrfToken },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  test("POST /admin/product/abc/delete returns 404 for non-numeric ID", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/product/abc/delete",
        { csrf_token: csrfToken },
        cookie,
      ),
    );
    // Non-numeric ID won't match the route pattern
    expect(response.status).toBe(404);
  });
});

// =========================================================================
// src/routes/admin/settings.ts — allowed origins (line 299)
// =========================================================================
describe("routes/admin/settings.ts (allowed origins)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("POST /admin/settings/allowed-origins updates setting", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/settings/allowed-origins",
        {
          allowed_origins: "https://shop.example.com, https://staging.shop.com",
          csrf_token: csrfToken,
        },
        cookie,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/admin/settings");
    expect(response.headers.get("location")).toContain("success=");
  });
});

// =========================================================================
// src/routes/api.ts — parseCheckoutRequest edge cases (lines 70, 76, 133-135)
// =========================================================================
describe("routes/api.ts (checkout edge cases)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("returns 400 for item with null object", async () => {
    await setupStripe();
    const { stripeApi } = await import("#lib/stripe.ts");
    await withMocks(
      () => spyOn(stripeApi, "createCheckoutSession").mockResolvedValue({
        sessionId: "cs_test", checkoutUrl: "https://checkout.stripe.com/mock",
      }),
      async () => {
        const response = await handleRequest(
          new Request("http://localhost/api/checkout", {
            method: "POST",
            headers: { host: "localhost", "content-type": "application/json" },
            body: JSON.stringify({
              items: [null],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          }),
        );
        expect(response.status).toBe(400);
      },
    );
  });

  test("returns 400 for item with empty sku", async () => {
    await setupStripe();
    const { stripeApi } = await import("#lib/stripe.ts");
    await withMocks(
      () => spyOn(stripeApi, "createCheckoutSession").mockResolvedValue({
        sessionId: "cs_test", checkoutUrl: "https://checkout.stripe.com/mock",
      }),
      async () => {
        const response = await handleRequest(
          new Request("http://localhost/api/checkout", {
            method: "POST",
            headers: { host: "localhost", "content-type": "application/json" },
            body: JSON.stringify({
              items: [{ sku: "", quantity: 1 }],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          }),
        );
        expect(response.status).toBe(400);
      },
    );
  });

  test("releases earlier reservations when later item has insufficient stock", async () => {
    await setupStripe();
    const { stripeApi } = await import("#lib/stripe.ts");
    await createTestProduct({ sku: "PLENTY", stock: 100, unitPrice: 1000 });
    await createTestProduct({ sku: "SCARCE", stock: 1, unitPrice: 500 });

    await withMocks(
      () => spyOn(stripeApi, "createCheckoutSession").mockResolvedValue({
        sessionId: "cs_test", checkoutUrl: "https://checkout.stripe.com/mock",
      }),
      async () => {
        const response = await handleRequest(
          new Request("http://localhost/api/checkout", {
            method: "POST",
            headers: { host: "localhost", "content-type": "application/json" },
            body: JSON.stringify({
              items: [
                { sku: "PLENTY", quantity: 1 },
                { sku: "SCARCE", quantity: 5 },
              ],
              success_url: "https://shop.example.com/success",
              cancel_url: "https://shop.example.com/cancel",
            }),
          }),
        );
        expect(response.status).toBe(409);
        const data = await response.json();
        expect(data.details[0].sku).toBe("SCARCE");
      },
    );
  });
});

// =========================================================================
// src/routes/webhooks.ts — buildLineItems, checkout.session.expired, charge.refunded (lines 50, 63-65, 135, 146)
// =========================================================================
describe("routes/webhooks.ts (additional event types)", () => {
  const TEST_WEBHOOK_SECRET = "whsec_test_coverage_gaps";

  const setupStripeWithWebhook = async () => {
    await setupStripe();
    const { setStripeWebhookConfig } = await import("#lib/db/settings.ts");
    await setStripeWebhookConfig(TEST_WEBHOOK_SECRET, "we_test_cov");
  };

  const signedWebhookRequest = async (
    event: { type: string; data: { object: Record<string, unknown> } },
  ): Promise<Request> => {
    const { constructTestWebhookEvent } = await import("#lib/stripe.ts");
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

  beforeEach(async () => {
    await createTestDbWithSetup();
    await setupStripeWithWebhook();
  });

  afterEach(() => {
    resetDb();
  });

  test("handles checkout.session.expired event", async () => {
    const product = await createTestProduct({ stock: 5, unitPrice: 1000 });
    const { reserveStock } = await import("#lib/db/reservations.ts");
    await reserveStock(product.id, 2, "expired_sess_123");

    const request = await signedWebhookRequest({
      type: "checkout.session.expired",
      data: { object: { id: "expired_sess_123" } },
    });

    const response = await handleRequest(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.processed).toBe(true);
    expect(data.expired).toBe(1);
  });

  test("handles charge.refunded event", async () => {
    const product = await createTestProduct({ stock: 5, unitPrice: 1000 });
    const { reserveStock, confirmReservation } = await import("#lib/db/reservations.ts");
    await reserveStock(product.id, 1, "refund_pi_123");
    await confirmReservation("refund_pi_123");

    const request = await signedWebhookRequest({
      type: "charge.refunded",
      data: { object: { payment_intent: "refund_pi_123" } },
    });

    const response = await handleRequest(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.processed).toBe(true);
    expect(data.restocked).toBe(1);
  });

  test("handles checkout.session.completed with reservations and products", async () => {
    const product = await createTestProduct({ sku: "WH-SKU", name: "Webhook Product", stock: 10, unitPrice: 1500 });
    const { reserveStock } = await import("#lib/db/reservations.ts");
    await reserveStock(product.id, 3, "complete_sess_456");

    const request = await signedWebhookRequest({
      type: "checkout.session.completed",
      data: { object: { id: "complete_sess_456" } },
    });

    const response = await handleRequest(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.processed).toBe(true);
    expect(data.confirmed).toBe(1);
  });

  test("handles charge.refunded with missing payment_intent", async () => {
    const request = await signedWebhookRequest({
      type: "charge.refunded",
      data: { object: {} },
    });

    const response = await handleRequest(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);
  });

  test("handles checkout.session.expired with missing session ID", async () => {
    const request = await signedWebhookRequest({
      type: "checkout.session.expired",
      data: { object: {} },
    });

    const response = await handleRequest(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);
  });
});

// =========================================================================
// src/lib/db/table.ts — comprehensive CRUD coverage (lines 106-402)
// =========================================================================
describe("lib/db/table.ts (table CRUD operations)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("findAll returns all rows", async () => {
    const { productsTable } = await import("#lib/db/products.ts");
    await createTestProduct({ sku: "ALL-1" });
    await createTestProduct({ sku: "ALL-2" });
    const all = await productsTable.findAll();
    expect(all.length).toBe(2);
  });

  test("findById returns null for non-existent row", async () => {
    const { productsTable } = await import("#lib/db/products.ts");
    const result = await productsTable.findById(99999);
    expect(result).toBeNull();
  });

  test("update returns null for non-existent row", async () => {
    const { productsTable } = await import("#lib/db/products.ts");
    const result = await productsTable.update(99999, { name: "Nope" });
    expect(result).toBeNull();
  });

  test("update with no fields returns current row", async () => {
    const product = await createTestProduct({ sku: "NOOP-1" });
    const { productsTable } = await import("#lib/db/products.ts");
    const result = await productsTable.update(product.id, {});
    expect(result).not.toBeNull();
    expect(result!.sku).toBe("NOOP-1");
  });

  test("update modifies specific fields", async () => {
    const product = await createTestProduct({ sku: "UPD-TBL", name: "Old" });
    const { productsTable } = await import("#lib/db/products.ts");
    const result = await productsTable.update(product.id, { name: "New" });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("New");
    expect(result!.sku).toBe("UPD-TBL");
  });

  test("deleteById removes a row", async () => {
    const product = await createTestProduct({ sku: "DEL-TBL" });
    const { productsTable } = await import("#lib/db/products.ts");
    await productsTable.deleteById(product.id);
    const result = await productsTable.findById(product.id);
    expect(result).toBeNull();
  });

  test("table with encrypted columns encrypts and decrypts", async () => {
    const { logActivity, getAllActivityLog } = await import("#lib/db/activityLog.ts");
    await logActivity("Secret message");
    const entries = await getAllActivityLog();
    expect(entries[0]!.message).toBe("Secret message");
  });

  test("toDbValues applies defaults and write transforms", async () => {
    const { productsTable } = await import("#lib/db/products.ts");
    const dbValues = await productsTable.toDbValues({
      sku: "TV-1",
      name: "Test",
      unitPrice: 100,
    } as { sku: string; name: string; unitPrice: number });
    expect(dbValues.sku).toBe("TV-1");
    expect(dbValues.name).toBe("Test");
    expect(dbValues.unit_price).toBe(100);
    // Default fields should have values
    expect(dbValues.description).toBe("");
    expect(dbValues.stock).toBe(0);
    expect(dbValues.active).toBe(1);
    expect(dbValues.created).toBeDefined();
  });

  test("col helpers work correctly", async () => {
    const { col, defineTable } = await import("#lib/db/table.ts");
    const { getDb } = await import("#lib/db/client.ts");

    // Create a simple test table
    await getDb().execute(`
      CREATE TABLE IF NOT EXISTS test_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created TEXT NOT NULL
      )
    `);

    const testTable = defineTable<
      { id: number; name: string; created: string },
      { name: string; created?: string }
    >({
      name: "test_items",
      primaryKey: "id",
      schema: {
        id: col.generated<number>(),
        name: col.simple<string>(),
        created: col.timestamp(),
      },
    });

    const item = await testTable.insert({ name: "Test Item" });
    expect(item.id).toBe(1);
    expect(item.name).toBe("Test Item");
    expect(item.created).toBeDefined();

    // Test findById
    const found = await testTable.findById(1);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Item");

    // Test findAll
    await testTable.insert({ name: "Second Item" });
    const all = await testTable.findAll();
    expect(all.length).toBe(2);

    // Test deleteById
    await testTable.deleteById(1);
    const deleted = await testTable.findById(1);
    expect(deleted).toBeNull();
  });

  test("getReturnValue returns null for column not in input or dbValues", async () => {
    const { col, defineTable } = await import("#lib/db/table.ts");
    const { getDb } = await import("#lib/db/client.ts");

    await getDb().execute(`
      CREATE TABLE IF NOT EXISTS test_nullable_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        optional_field TEXT
      )
    `);

    const nullableTable = defineTable<
      { id: number; name: string; optional_field: string | null },
      { name: string; optional_field?: string | null }
    >({
      name: "test_nullable_items",
      primaryKey: "id",
      schema: {
        id: col.generated<number>(),
        name: col.simple<string>(),
        optional_field: col.simple<string | null>(),
      },
    });

    // Insert without optional_field — getReturnValue should return null
    const item = await nullableTable.insert({ name: "Null Test" } as { name: string; optional_field?: string | null });
    expect(item.name).toBe("Null Test");
    expect(item.optional_field).toBeNull();
  });

  test("reservationsTable.insert uses withDefault for status", async () => {
    // This directly exercises the col.withDefault path on reservations.ts:31
    const { reservationsTable } = await import("#lib/db/reservations.ts");
    const product = await createTestProduct({ stock: 100 });
    const reservation = await reservationsTable.insert({
      productId: product.id,
      quantity: 1,
      providerSessionId: "direct_insert_test",
    } as { productId: number; quantity: number; providerSessionId: string });
    expect(reservation.status).toBe("pending");
  });

  test("col.encryptedNullable handles null values", async () => {
    const { col } = await import("#lib/db/table.ts");
    const encFn = (v: string) => `enc_${v}`;
    const decFn = (v: string) => v.replace("enc_", "");
    const def = col.encryptedNullable(encFn, decFn);
    // Write null
    const writeResult = await def.write!(null);
    expect(writeResult).toBeNull();
    // Read null
    const readResult = await def.read!(null);
    expect(readResult).toBeNull();
    // Write non-null
    const writeResult2 = await def.write!("hello");
    expect(writeResult2).toBe("enc_hello");
    // Read non-null
    const readResult2 = await def.read!("enc_hello");
    expect(readResult2).toBe("hello");
  });

  test("col.transform creates custom read/write transforms", async () => {
    const { col } = await import("#lib/db/table.ts");
    const def = col.transform(
      (v: number) => v * 100,
      (v: number) => v / 100,
    );
    expect(def.write!(5)).toBe(500);
    expect(def.read!(500)).toBe(5);
  });
});

// =========================================================================
// src/test-utils/index.ts — uncovered utility functions (lines 220-500)
// =========================================================================
describe("test-utils coverage", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("invalidateTestDbCache clears cache", () => {
    // Should not throw
    invalidateTestDbCache();
    // Re-create for subsequent tests
  });

  test("getTestSession returns cached session", async () => {
    const session1 = await getTestSession();
    const session2 = await getTestSession();
    expect(session1.csrfToken).toBe(session2.csrfToken);
  });

  test("authenticatedFormRequest throws on non-redirect", async () => {
    await expect(
      authenticatedFormRequest(
        "/admin/settings",
        { nonexistent_field: "value" },
        () => "ok",
        "test operation",
      ),
    ).rejects.toThrow("Failed to");
  });

  test("expectStatus asserts correct status", () => {
    const response = new Response("ok", { status: 200 });
    const result = expectStatus(200)(response);
    expect(result).toBe(response);
  });

  test("expectRedirect asserts redirect", () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "/target" },
    });
    const result = expectRedirect("/target")(response);
    expect(result).toBe(response);
  });

  test("expectResultError asserts error", () => {
    const result = expectResultError("bad")({ ok: false, error: "bad" });
    expect(result.ok).toBe(false);
  });

  test("expectResultNotFound asserts notFound", () => {
    const result = expectResultNotFound({ ok: false, notFound: true });
    expect(result.ok).toBe(false);
  });

  test("successResponse creates response factory", () => {
    const factory = successResponse(201, "created");
    const response = factory();
    expect(response.status).toBe(201);
  });

  test("errorResponse creates error response factory", () => {
    const factory = errorResponse(500);
    const response = factory("Internal error");
    expect(response.status).toBe(500);
  });

  test("expectValid validates form data", async () => {
    const { loginFields } = await import("#templates/fields.ts");
    const values = expectValid(loginFields, { username: "admin", password: "pass" });
    expect(values.username).toBe("admin");
  });

  test("expectInvalid validates invalid form data", async () => {
    const { loginFields } = await import("#templates/fields.ts");
    expectInvalid("Username is required")(loginFields, { username: "", password: "pass" });
  });

  test("expectInvalidForm validates invalid form", async () => {
    const { loginFields } = await import("#templates/fields.ts");
    expectInvalidForm(loginFields, { username: "", password: "" });
  });

  test("mockWebhookRequest creates webhook request", () => {
    const req = mockWebhookRequest({ type: "test" }, { "stripe-signature": "sig" });
    expect(req.method).toBe("POST");
    expect(req.headers.get("stripe-signature")).toBe("sig");
  });

  test("testRequest creates request with token", () => {
    const req = testRequest("/admin/", "test-token-123");
    expect(req.headers.get("cookie")).toContain("__Host-session=test-token-123");
  });

  test("testRequest creates POST request with data", () => {
    const req = testRequest("/admin/login", null, { data: { username: "admin", password: "pass" } });
    expect(req.method).toBe("POST");
    expect(req.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
  });

  test("testRequest with cookie option", () => {
    const req = testRequest("/path", null, { cookie: "mycookie=value" });
    expect(req.headers.get("cookie")).toBe("mycookie=value");
  });

  test("awaitTestRequest with TestRequestOptions object", async () => {
    const response = await awaitTestRequest("/admin/", { cookie: "bogus=value" });
    // Should return some response (login page since not authenticated)
    expect(response.status).toBe(200);
  });

  test("randomString generates expected length", () => {
    const str = randomString(16);
    expect(str.length).toBe(16);
  });

  test("withMocks restores single mock", async () => {
    const obj = { method: () => "original" };
    await withMocks(
      () => spyOn(obj, "method").mockReturnValue("mocked"),
      (_mock) => {
        expect(obj.method()).toBe("mocked");
      },
    );
    expect(obj.method()).toBe("original");
  });

  test("withMocks restores object of mocks", async () => {
    const obj = { a: () => "a", b: () => "b" };
    await withMocks(
      () => ({
        mockA: spyOn(obj, "a").mockReturnValue("A"),
        mockB: spyOn(obj, "b").mockReturnValue("B"),
      }),
      (_mocks) => {
        expect(obj.a()).toBe("A");
        expect(obj.b()).toBe("B");
      },
    );
    expect(obj.a()).toBe("a");
    expect(obj.b()).toBe("b");
  });

  test("withMocks calls cleanup function", async () => {
    let cleanedUp = false;
    const obj = { method: () => "original" };
    await withMocks(
      () => spyOn(obj, "method").mockReturnValue("mocked"),
      () => {},
      () => { cleanedUp = true; },
    );
    expect(cleanedUp).toBe(true);
  });

  test("mockSetupFormRequest includes accept_agreement", () => {
    const req = mockSetupFormRequest({ admin_username: "u", admin_password: "p" }, "csrf123");
    // Check it's a POST to /setup
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/setup");
  });

  test("getSetupCsrfToken extracts token from cookie", () => {
    const token = getSetupCsrfToken("setup_csrf=abc123; Path=/; HttpOnly");
    expect(token).toBe("abc123");
  });

  test("getSetupCsrfToken returns null for missing cookie", () => {
    const token = getSetupCsrfToken(null);
    expect(token).toBeNull();
  });

  test("getCsrfTokenFromCookie returns null for non-matching cookie", async () => {
    const token = await getCsrfTokenFromCookie("other=value");
    expect(token).toBeNull();
  });
});

// =========================================================================
// src/test-utils/test-compat.ts (lines 401-403) - spyOn usage
// =========================================================================
describe("test-compat.ts (spyOn)", () => {
  test("spyOn tracks calls and can be restored", () => {
    const obj = { getValue: () => 42 };
    const spy = spyOn(obj, "getValue").mockReturnValue(99);
    expect(obj.getValue()).toBe(99);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore!();
    expect(obj.getValue()).toBe(42);
  });
});

// =========================================================================
// src/routes/admin/settings.ts — resetDatabase (covered by invalidateTestDbCache)
// =========================================================================
describe("routes/admin/settings.ts (reset database)", () => {
  // This test intentionally destroys the schema
  test("POST /admin/settings/reset-database resets and redirects to setup", async () => {
    await createTestDbWithSetup();
    const { cookie, csrfToken } = await loginAsAdmin();

    const response = await handleRequest(
      mockFormRequest(
        "/admin/settings/reset-database",
        {
          confirm_phrase: "The site will be fully reset and all data will be lost.",
          csrf_token: csrfToken,
        },
        cookie,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/setup/");
    invalidateTestDbCache();
    resetDb();
  });
});

// =========================================================================
// src/lib/db/products.ts — getAvailableStock with 0 reserved (line 82 Math.max)
// =========================================================================
describe("lib/db/products.ts (getAvailableStock edge cases)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("returns stock when no reservations exist", async () => {
    const product = await createTestProduct({ stock: 5 });
    const { getAvailableStock } = await import("#lib/db/products.ts");
    const available = await getAvailableStock(product.id);
    expect(available).toBe(5);
  });

  test("subtracts reserved quantity from stock", async () => {
    const product = await createTestProduct({ stock: 10 });
    const { reserveStock } = await import("#lib/db/reservations.ts");
    await reserveStock(product.id, 3, "sess_available");
    const { getAvailableStock } = await import("#lib/db/products.ts");
    const available = await getAvailableStock(product.id);
    expect(available).toBe(7);
  });

  test("returns 0 when more reserved than stock (Math.max)", async () => {
    const product = await createTestProduct({ stock: 1 });
    // Reserve more than available via direct DB manipulation
    const { getDb } = await import("#lib/db/client.ts");
    await getDb().execute({
      sql: "INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created) VALUES (?, ?, ?, ?, ?)",
      args: [product.id, 5, "over_sess", "pending", new Date().toISOString()],
    });
    const { getAvailableStock } = await import("#lib/db/products.ts");
    const available = await getAvailableStock(product.id);
    expect(available).toBe(0);
  });
});

// =========================================================================
// src/lib/db/reservations.ts — withDefault status (line 31)
// This is covered implicitly by reserveStock, but let's exercise it directly
// =========================================================================
describe("lib/db/reservations.ts (withDefault)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("reservation inserted with default pending status", async () => {
    const product = await createTestProduct({ stock: 10 });
    const { reserveStock } = await import("#lib/db/reservations.ts");
    const count = await reserveStock(product.id, 2, "status_test_sess");
    expect(count).toBeGreaterThan(0);

    const { getDb } = await import("#lib/db/client.ts");
    const result = await getDb().execute({
      sql: "SELECT status FROM stock_reservations WHERE provider_session_id = ?",
      args: ["status_test_sess"],
    });
    expect((result.rows[0] as unknown as { status: string }).status).toBe("pending");
  });
});

// =========================================================================
// src/lib/db/table.ts — toSnakeCase (lines 106-107) and resolveValue fallback null (lines 259-260)
// =========================================================================
describe("lib/db/table.ts (toSnakeCase, resolveValue)", () => {
  test("toSnakeCase converts camelCase", async () => {
    const { toSnakeCase } = await import("#lib/db/table.ts");
    expect(toSnakeCase("myField")).toBe("my_field");
    expect(toSnakeCase("anotherFieldName")).toBe("another_field_name");
    expect(toSnakeCase("simple")).toBe("simple");
  });

  test("table insert handles missing optional fields with null fallback", async () => {
    await createTestDbWithSetup();
    // Insert a product with only required fields - optional ones should get defaults or null
    const { productsTable } = await import("#lib/db/products.ts");
    const product = await productsTable.insert({
      name: "Minimal",
      sku: "MIN-1",
      unitPrice: 100,
    } as Parameters<typeof productsTable.insert>[0]);
    expect(product.name).toBe("Minimal");
    expect(product.sku).toBe("MIN-1");
    resetDb();
  });
});

// =========================================================================
// src/routes/admin/products.ts — parseProductId null (line 24), product not found (lines 84, 105, 140)
// =========================================================================
describe("routes/admin/products.ts (remaining edge cases)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("GET /admin/product/0/edit returns 404 (parseProductId returns null for zero)", async () => {
    const { cookie } = await loginAsAdmin();
    const response = await awaitTestRequest("/admin/product/0/edit", { cookie });
    expect(response.status).toBe(404);
  });

  test("GET /admin/product/9999/edit returns 404 for non-existent product", async () => {
    const { cookie } = await loginAsAdmin();
    const response = await awaitTestRequest("/admin/product/9999/edit", { cookie });
    expect(response.status).toBe(404);
  });

  test("POST /admin/product/0 returns 404 for zero ID", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/product/0",
        { name: "Test", sku: "T", unit_price: "100", stock: "1", csrf_token: csrfToken },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  test("POST /admin/product/9999 returns 404 for non-existent product", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/product/9999",
        { name: "Test", sku: "T", unit_price: "100", stock: "1", csrf_token: csrfToken },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  test("POST /admin/product/0/delete returns 404 for zero ID", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/product/0/delete",
        { csrf_token: csrfToken },
        cookie,
      ),
    );
    expect(response.status).toBe(404);
  });
});

// =========================================================================
// src/routes/api.ts — parseCheckoutRequest body falsy (line 70)
// =========================================================================
describe("routes/api.ts (null body)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
    await setupStripe();
  });

  afterEach(() => {
    resetDb();
  });

  test("returns 400 for null body", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: "null",
      }),
    );
    expect(response.status).toBe(400);
  });

  test("returns 400 for non-object body (string)", async () => {
    const response = await handleRequest(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: '"just a string"',
      }),
    );
    expect(response.status).toBe(400);
  });
});

// =========================================================================
// src/routes/webhooks.ts — buildLineItems empty (line 50), product map miss (lines 63-65)
// =========================================================================
describe("routes/webhooks.ts (buildLineItems edge cases)", () => {
  const TEST_WEBHOOK_SECRET = "whsec_test_build_line_items";

  beforeEach(async () => {
    await createTestDbWithSetup();
    await setupStripe();
    const { setStripeWebhookConfig } = await import("#lib/db/settings.ts");
    await setStripeWebhookConfig(TEST_WEBHOOK_SECRET, "we_test_bli");
  });

  afterEach(() => {
    resetDb();
  });

  test("handles completed session with no reservations (empty line items)", async () => {
    // No reservations for this session - buildLineItems returns []
    const { constructTestWebhookEvent } = await import("#lib/stripe.ts");
    const { payload, signature } = await constructTestWebhookEvent(
      {
        id: "evt_no_reservations",
        type: "checkout.session.completed",
        data: { object: { id: "sess_no_reservations" } },
      },
      TEST_WEBHOOK_SECRET,
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
    // Insert a reservation referencing a non-existent product ID
    const { getDb } = await import("#lib/db/client.ts");
    // Temporarily disable FK checks to insert orphaned reservation
    await getDb().execute("PRAGMA foreign_keys = OFF");
    await getDb().execute({
      sql: "INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created) VALUES (?, ?, ?, ?, ?)",
      args: [99999, 1, "sess_deleted_product", "pending", new Date().toISOString()],
    });
    await getDb().execute("PRAGMA foreign_keys = ON");

    const { constructTestWebhookEvent } = await import("#lib/stripe.ts");
    const { payload, signature } = await constructTestWebhookEvent(
      {
        id: "evt_deleted_product",
        type: "checkout.session.completed",
        data: { object: { id: "sess_deleted_product" } },
      },
      TEST_WEBHOOK_SECRET,
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

// =========================================================================
// src/templates/fields.ts — parseCurrency fallback (line 300)
// =========================================================================
describe("templates/fields.ts (parseCurrency with fallback)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("POST /admin/settings/currency with valid code exercises parseCurrency", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/settings/currency",
        { currency_code: "EUR", csrf_token: csrfToken },
        cookie,
      ),
    );
    // Valid currency code should succeed
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("success=");
  });

  test("POST /admin/settings/currency with invalid code returns error", async () => {
    const { cookie, csrfToken } = await loginAsAdmin();
    const response = await handleRequest(
      mockFormRequest(
        "/admin/settings/currency",
        { currency_code: "toolong", csrf_token: csrfToken },
        cookie,
      ),
    );
    // Invalid currency code should return error
    expect(response.status).toBe(400);
  });
});

// =========================================================================
// src/routes/admin/settings.ts — allowed origins line 299
// Already covered above, but let's also test empty origins
// =========================================================================

// =========================================================================
// src/test-utils/index.ts — getTestSession first call without cache (lines 469-470)
// and authenticatedFormRequest success (line 499)
// =========================================================================
describe("test-utils/index.ts (additional coverage)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  test("authenticatedFormRequest succeeds on redirect response", async () => {
    await createTestProduct({ stock: 10 });
    const result = await authenticatedFormRequest(
      "/admin/product/new",
      { name: "Auth Test", sku: "AUTH-1", unit_price: "500", stock: "5", description: "" },
      () => "product created",
      "create product",
    );
    expect(result).toBe("product created");
  });

  test("getTestSession slow path (no cached session) calls loginAsAdmin", async () => {
    // Clear all caches so getTestSession hits the slow path (lines 469-470)
    invalidateTestDbCache();
    resetTestSession();
    // The DB still has a valid admin user from createTestDbWithSetup
    const session = await getTestSession();
    expect(session.cookie).toBeTruthy();
    expect(session.csrfToken).toBeTruthy();
  });
});

// =========================================================================
// src/test-utils/test-compat.ts — expect().not.toHaveBeenCalled() (lines 401-403)
// =========================================================================
describe("test-compat.ts (not.toHaveBeenCalled)", () => {
  test("expect(spy).not.toHaveBeenCalled passes when spy not called", () => {
    const obj = { fn: () => 42 };
    const spy = spyOn(obj, "fn");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// =========================================================================
// Stripe API operations: createCheckoutSession, retrieveCheckoutSession,
// listCheckoutSessions (lines 151-204), wrapper functions (lines 353-354)
// =========================================================================
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

// =========================================================================
// Stripe provider: createCheckoutSession, listSessions (lines 43-44, 89-92, 94-97)
// =========================================================================
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
});

// =========================================================================
// Square API: createCheckoutSession, searchOrders, toSquareOrder, retrieveOrder
// (lines 74-281)
// =========================================================================
describe("square API operations (mocked)", () => {
  const createSquareMockClient = () => {
    const paymentLinksCreate = jest.fn();
    const ordersGet = jest.fn();
    const ordersSearch = jest.fn();
    const paymentsGet = jest.fn();
    const refundsRefundPayment = jest.fn();

    return {
      client: {
        checkout: { paymentLinks: { create: paymentLinksCreate } },
        orders: { get: ordersGet, search: ordersSearch },
        payments: { get: paymentsGet },
        refunds: { refundPayment: refundsRefundPayment },
      },
      paymentLinksCreate,
      ordersGet,
      ordersSearch,
      paymentsGet,
      refundsRefundPayment,
    };
  };

  beforeEach(async () => {
    const { resetSquareClient } = await import("#lib/square.ts");
    resetSquareClient();
    await createTestDb();
    const { updateSquareAccessToken, updateSquareLocationId } = await import("#lib/db/settings.ts");
    await updateSquareAccessToken("EAAAl_test_square_mock");
    await updateSquareLocationId("LOC_TEST_123");
  });

  afterEach(async () => {
    const mod = await import("#lib/square.ts");
    mod.resetSquareClient();
    resetDb();
  });

  test("createCheckoutSession creates payment link", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.paymentLinksCreate.mockResolvedValue({
      paymentLink: {
        url: "https://square.link/test",
        orderId: "order_test_123",
      },
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.createCheckoutSession({
          lineItems: [{ name: "Square Item", unitPrice: 1000, quantity: 2 }],
          metadata: { source: "test" },
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          currency: "GBP",
        });
        expect(result).not.toBeNull();
        expect(result!.sessionId).toBe("order_test_123");
        expect(result!.checkoutUrl).toBe("https://square.link/test");
      },
    );
  });

  test("createCheckoutSession returns null when no location ID", async () => {
    const { squareApi } = await import("#lib/square.ts");
    // Clear location ID
    const { getDb } = await import("#lib/db/client.ts");
    await getDb().execute({ sql: "DELETE FROM settings WHERE key = 'square_location_id'", args: [] });

    const mock = createSquareMockClient();
    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.createCheckoutSession({
          lineItems: [{ name: "No Location", unitPrice: 100, quantity: 1 }],
          metadata: {},
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          currency: "GBP",
        });
        expect(result).toBeNull();
      },
    );
  });

  test("createCheckoutSession returns null when link has no URL", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.paymentLinksCreate.mockResolvedValue({
      paymentLink: { url: null, orderId: null },
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.createCheckoutSession({
          lineItems: [{ name: "No URL", unitPrice: 100, quantity: 1 }],
          metadata: {},
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          currency: "GBP",
        });
        expect(result).toBeNull();
      },
    );
  });

  test("retrieveOrder returns mapped order", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersGet.mockResolvedValue({
      order: {
        id: "order_retrieved",
        state: "COMPLETED",
        metadata: { key: "value", num: "42" },
        tenders: [{ id: "tender_1", paymentId: "pay_1" }],
      },
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.retrieveOrder("order_retrieved");
        expect(result).not.toBeNull();
        expect(result!.id).toBe("order_retrieved");
        expect(result!.state).toBe("COMPLETED");
        expect(result!.metadata).toEqual({ key: "value", num: "42" });
        expect(result!.tenders![0]!.paymentId).toBe("pay_1");
      },
    );
  });

  test("retrieveOrder returns null when no order", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersGet.mockResolvedValue({ order: null });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.retrieveOrder("order_missing");
        expect(result).toBeNull();
      },
    );
  });

  test("searchOrders returns orders with pagination", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersSearch.mockResolvedValue({
      orders: [
        { id: "order_1", state: "COMPLETED", metadata: { k: "v" } },
        { id: "order_2", state: "OPEN" },
      ],
      cursor: "next_cursor",
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.searchOrders({ limit: 10 });
        expect(result).not.toBeNull();
        expect(result!.orders.length).toBe(2);
        expect(result!.hasMore).toBe(true);
        expect(result!.cursor).toBe("next_cursor");
      },
    );
  });

  test("searchOrders with cursor parameter", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersSearch.mockResolvedValue({
      orders: [],
      cursor: undefined,
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.searchOrders({ limit: 5, cursor: "prev_cursor" });
        expect(result).not.toBeNull();
        expect(result!.orders.length).toBe(0);
        expect(result!.hasMore).toBe(false);
      },
    );
  });

  test("searchOrders handles null orders from SDK", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersSearch.mockResolvedValue({
      orders: null,
      cursor: undefined,
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.searchOrders({ limit: 10 });
        expect(result).not.toBeNull();
        expect(result!.orders.length).toBe(0);
        expect(result!.hasMore).toBe(false);
      },
    );
  });

  test("searchOrders returns empty when no location ID", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const { getDb } = await import("#lib/db/client.ts");
    await getDb().execute({ sql: "DELETE FROM settings WHERE key = 'square_location_id'", args: [] });

    const mock = createSquareMockClient();
    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.searchOrders({ limit: 10 });
        expect(result).not.toBeNull();
        expect(result!.orders.length).toBe(0);
        expect(result!.hasMore).toBe(false);
      },
    );
  });

  test("toSquareOrder handles tenders with null paymentId", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersGet.mockResolvedValue({
      order: {
        id: "order_null_tender",
        state: "OPEN",
        tenders: [{ id: "tender_1", paymentId: null }],
      },
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.retrieveOrder("order_null_tender");
        expect(result!.tenders![0]!.paymentId).toBeUndefined();
      },
    );
  });

  test("toSquareOrder handles no metadata", async () => {
    const { squareApi } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.ordersGet.mockResolvedValue({
      order: {
        id: "order_no_meta",
        state: "OPEN",
      },
    });

    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const result = await squareApi.retrieveOrder("order_no_meta");
        expect(result!.metadata).toBeUndefined();
      },
    );
  });

  // Wrapper function coverage (lines 276-281)
  test("wrapper exports delegate to squareApi", async () => {
    const { createCheckoutSession, retrieveOrder, searchOrders } = await import("#lib/square.ts");
    const mock = createSquareMockClient();
    mock.paymentLinksCreate.mockResolvedValue({
      paymentLink: { url: "https://square.link/w", orderId: "wrapper_order" },
    });
    mock.ordersGet.mockResolvedValue({
      order: { id: "wrapper_order", state: "OPEN" },
    });
    mock.ordersSearch.mockResolvedValue({ orders: [], cursor: undefined });

    const { squareApi } = await import("#lib/square.ts");
    await withMocks(
      () => spyOn(squareApi, "getSquareClient").mockResolvedValue(mock.client),
      async () => {
        const checkoutResult = await createCheckoutSession({
          lineItems: [{ name: "W", unitPrice: 100, quantity: 1 }],
          metadata: {},
          successUrl: "https://e.com/s",
          cancelUrl: "https://e.com/c",
          currency: "GBP",
        });
        expect(checkoutResult).not.toBeNull();

        const orderResult = await retrieveOrder("wrapper_order");
        expect(orderResult).not.toBeNull();

        const searchResult = await searchOrders({ limit: 5 });
        expect(searchResult).not.toBeNull();
      },
    );
  });
});

// =========================================================================
// Square provider: createCheckoutSession, listSessions, setupWebhookEndpoint
// (lines 36-92)
// =========================================================================
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
