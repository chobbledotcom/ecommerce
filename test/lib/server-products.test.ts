import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import { handleRequest } from "#routes";
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
