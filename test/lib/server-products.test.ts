import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import { handleRequest } from "#routes";
import { getDb } from "#lib/db/client.ts";
import {
  awaitTestRequest,
  createTestDbWithSetup,
  createTestProduct,
  loginAsAdmin,
  mockFormRequest,
  mockRequest,
  resetDb,
  expectAdminRedirect,
} from "#test-utils";

describe("server (admin products)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("GET /admin/ (product list)", () => {
    test("shows login page when not authenticated", async () => {
      const response = await handleRequest(mockRequest("/admin/"));
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Login");
    });

    test("shows product list when authenticated", async () => {
      const { cookie } = await loginAsAdmin();
      await createTestProduct({ name: "Widget", sku: "WDG-1" });

      const response = await awaitTestRequest("/admin/", { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Products");
      expect(html).toContain("Widget");
      expect(html).toContain("WDG-1");
    });

    test("shows empty state when no products", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/", { cookie });
      const html = await response.text();
      expect(html).toContain("No products yet");
    });

    test("shows add product link", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/", { cookie });
      const html = await response.text();
      expect(html).toContain("/admin/product/new");
    });
  });

  describe("GET /admin/product/new", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(mockRequest("/admin/product/new"));
      expectAdminRedirect(response);
    });

    test("shows new product form when authenticated", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/product/new", { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("New Product");
      expect(html).toContain("Create Product");
    });
  });

  describe("POST /admin/product/new", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/product/new", { name: "Test" }),
      );
      expectAdminRedirect(response);
    });

    test("creates a product and redirects", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/product/new",
          {
            name: "New Widget",
            sku: "NEW-WDG",
            description: "A great widget",
            unit_price: "1500",
            stock: "10",
            active: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/");

      // Verify product was created
      const listResponse = await awaitTestRequest("/admin/", { cookie });
      const html = await listResponse.text();
      expect(html).toContain("New Widget");
      expect(html).toContain("NEW-WDG");
    });

    test("rejects invalid form data", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/product/new",
          {
            name: "",
            sku: "",
            unit_price: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
    });

    test("rejects invalid CSRF token", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/product/new",
          {
            name: "Widget",
            sku: "WDG",
            unit_price: "1000",
            csrf_token: "invalid",
          },
          cookie,
        ),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("GET /admin/product/:id/edit", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(mockRequest("/admin/product/1/edit"));
      expectAdminRedirect(response);
    });

    test("shows edit form for existing product", async () => {
      const { cookie } = await loginAsAdmin();
      const product = await createTestProduct({ name: "Editable", sku: "EDIT-1", unitPrice: 2000 });

      const response = await awaitTestRequest(`/admin/product/${product.id}/edit`, { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Edit Product");
      expect(html).toContain("Editable");
      expect(html).toContain("EDIT-1");
      expect(html).toContain("Delete Product");
    });

    test("returns 404 for non-existent product", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/product/9999/edit", { cookie });
      expect(response.status).toBe(404);
    });
  });

  describe("POST /admin/product/:id (update)", () => {
    test("updates product and redirects", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ name: "Old Name", sku: "UPD-1" });

      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "Updated Name",
            sku: "UPD-1",
            description: "Updated desc",
            unit_price: "3000",
            stock: "20",
            active: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/");

      // Verify product was updated
      const listResponse = await awaitTestRequest("/admin/", { cookie });
      const html = await listResponse.text();
      expect(html).toContain("Updated Name");
    });

    test("returns 404 for non-existent product", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/product/9999",
          {
            name: "Test",
            sku: "TEST",
            unit_price: "1000",
            stock: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(404);
    });

    test("rejects invalid form data", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct();

      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "",
            sku: "",
            unit_price: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("POST /admin/product/:id/delete", () => {
    test("deletes product and redirects", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ name: "Deletable", sku: "DEL-1" });

      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}/delete`,
          { csrf_token: csrfToken },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/");

      // Verify product was deleted
      const listResponse = await awaitTestRequest("/admin/", { cookie });
      const html = await listResponse.text();
      expect(html).not.toContain("Deletable");
    });

    test("returns 404 for invalid product ID path", async () => {
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

    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/product/1/delete", {}),
      );
      expectAdminRedirect(response);
    });
  });

  describe("stockText", () => {
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

  describe("admin products edge cases", () => {
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

  describe("remaining product edge cases", () => {
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

  describe("stock display (remaining + sold)", () => {
    test("edit form shows remaining stock instead of total", async () => {
      const { cookie } = await loginAsAdmin();
      const product = await createTestProduct({ stock: 50, sku: "STOCK-1" });

      // Simulate 10 sold (confirmed reservation)
      await getDb().execute({
        sql: `INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
              VALUES (?, 10, 'session-1', 'confirmed', datetime('now'))`,
        args: [product.id],
      });

      const response = await awaitTestRequest(`/admin/product/${product.id}/edit`, { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      // Should show remaining (40), not total (50)
      expect(html).toContain('value="40"');
      // Should show sold count in label
      expect(html).toContain("(10 sold)");
    });

    test("edit form shows -1 directly for unlimited stock", async () => {
      const { cookie } = await loginAsAdmin();
      const product = await createTestProduct({ stock: -1, sku: "UNLIM-1" });

      const response = await awaitTestRequest(`/admin/product/${product.id}/edit`, { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('value="-1"');
      // sold count is 0 for unlimited
      expect(html).toContain("(0 sold)");
    });

    test("update back-calculates stock from remaining + sold", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ stock: 50, sku: "CALC-1" });

      // Simulate 10 sold
      await getDb().execute({
        sql: `INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
              VALUES (?, 10, 'session-calc', 'confirmed', datetime('now'))`,
        args: [product.id],
      });

      // User sets remaining to 30
      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "Calc Product",
            sku: "CALC-1",
            description: "",
            unit_price: "1000",
            stock: "30",
            active: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);

      // Verify actual stock stored is remaining + sold = 30 + 10 = 40
      const row = await getDb().execute({
        sql: "SELECT stock FROM products WHERE id = ?",
        args: [product.id],
      });
      expect((row.rows[0] as unknown as { stock: number }).stock).toBe(40);
    });

    test("update stores -1 directly for unlimited stock", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ stock: 50, sku: "UNLIM-UPD" });

      // Simulate 5 sold
      await getDb().execute({
        sql: `INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
              VALUES (?, 5, 'session-unlim', 'pending', datetime('now'))`,
        args: [product.id],
      });

      // User sets stock to -1 (unlimited)
      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "Unlim Product",
            sku: "UNLIM-UPD",
            description: "",
            unit_price: "1000",
            stock: "-1",
            active: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);

      // Verify stock stored is -1, not -1 + 5
      const row = await getDb().execute({
        sql: "SELECT stock FROM products WHERE id = ?",
        args: [product.id],
      });
      expect((row.rows[0] as unknown as { stock: number }).stock).toBe(-1);
    });

    test("update an unlimited stock product keeps stock as -1", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ stock: -1, sku: "UNLIM-EDIT" });

      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "Updated Unlimited",
            sku: "UNLIM-EDIT",
            description: "",
            unit_price: "2000",
            stock: "-1",
            active: "1",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);

      const row = await getDb().execute({
        sql: "SELECT stock FROM products WHERE id = ?",
        args: [product.id],
      });
      expect((row.rows[0] as unknown as { stock: number }).stock).toBe(-1);
    });

    test("update with validation error passes sold count back to form", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const product = await createTestProduct({ stock: 20, sku: "VALERR-1" });

      await getDb().execute({
        sql: `INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
              VALUES (?, 3, 'session-val', 'pending', datetime('now'))`,
        args: [product.id],
      });

      const response = await handleRequest(
        mockFormRequest(
          `/admin/product/${product.id}`,
          {
            name: "",
            sku: "",
            unit_price: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("(3 sold)");
    });
  });

  describe("escapeHtml via product display", () => {
    test("escapes HTML characters in product names on admin page", async () => {
      await createTestProduct({ name: '<script>alert("xss")</script>', sku: "XSS-1" });
      await createTestProduct({ name: "Widgets & Gadgets", sku: "AMP-1" });
      await createTestProduct({ name: 'Say "hello"', sku: "QUOT-1" });
      const { cookie } = await loginAsAdmin();
      const response = await awaitTestRequest("/admin/", { cookie });
      const html = await response.text();
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;");
      expect(html).not.toContain("<script>alert");
    });
  });
});
