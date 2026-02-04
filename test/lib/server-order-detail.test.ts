import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import { handleRequest } from "#routes";
import { stripeApi } from "#lib/stripe.ts";
import { reserveStock, confirmReservation, expireReservation } from "#lib/db/reservations.ts";
import { productsTable } from "#lib/db/products.ts";
import {
  awaitTestRequest,
  createTestDbWithSetup,
  loginAsAdmin,
  mockFormRequest,
  mockRequest,
  resetDb,
  setupStripe,
  expectAdminRedirect,
  withMocks,
} from "#test-utils";

describe("server (admin order detail)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("GET /admin/orders/:sessionId", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(mockRequest("/admin/orders/cs_test_123"));
      expectAdminRedirect(response);
    });

    test("returns 400 when no payment provider configured", async () => {
      const { cookie } = await loginAsAdmin();
      const response = await awaitTestRequest("/admin/orders/cs_test_123", { cookie });
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Payment provider not configured");
    });

    test("returns 404 when session not found", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue(null),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_nonexistent", { cookie });
          expect(response.status).toBe(404);
          const html = await response.text();
          expect(html).toContain("Order not found");
        },
      );
    });

    test("shows order detail page with session info", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_detail_1",
          payment_status: "paid",
          amount_total: 3500,
          currency: "gbp",
          customer_details: { email: "buyer@example.com", name: "Test Buyer" },
          customer_email: "buyer@example.com",
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_123",
          line_items: {
            data: [
              {
                description: "Concert Ticket",
                quantity: 2,
                price: { unit_amount: 1500 },
                amount_total: 3000,
              },
              {
                description: "Booking Fee",
                quantity: 1,
                price: { unit_amount: 500 },
                amount_total: 500,
              },
            ],
          },
          metadata: { reservation_ids: "1,2" },
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_detail_1", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Order Detail");
          expect(html).toContain("cs_test_detail_1");
          expect(html).toContain("paid");
          expect(html).toContain("35.00 GBP");
          expect(html).toContain("buyer@example.com");
          expect(html).toContain("Test Buyer");
          expect(html).toContain("pi_test_123");
          expect(html).toContain("Concert Ticket");
          expect(html).toContain("Booking Fee");
          expect(html).toContain("reservation_ids");
          expect(html).toContain("Stripe");
          expect(html).toContain("dashboard.stripe.com");
        },
      );
    });

    test("shows stock reservations when they exist", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      // Create a product and reservation
      const product = await productsTable.insert({
        sku: "TEST-SKU-1",
        name: "Test Product",
        unitPrice: 1500,
        stock: 10,
      });
      await reserveStock(product.id, 2, "cs_test_with_reservation");
      await confirmReservation("cs_test_with_reservation");

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_with_reservation",
          payment_status: "paid",
          amount_total: 3000,
          currency: "gbp",
          customer_details: { email: "test@example.com" },
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_456",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_with_reservation", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Stock Reservations");
          expect(html).toContain("Confirmed");
        },
      );
    });

    test("shows refund button for paid orders with payment reference", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_refundable",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_refundable",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_refundable", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Issue Refund");
          expect(html).toContain("confirm_refund");
          expect(html).toContain("REFUND");
        },
      );
    });

    test("does not show refund button for unpaid orders", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_unpaid",
          payment_status: "unpaid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_unpaid",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_unpaid", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).not.toContain("Issue Refund");
        },
      );
    });

    test("shows success message after refund", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_success_msg",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_msg",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest(
            "/admin/orders/cs_test_success_msg?success=Refund+issued+successfully",
            { cookie },
          );
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Refund issued successfully");
        },
      );
    });
  });

  describe("POST /admin/orders/:sessionId/refund", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/orders/cs_test_123/refund", { confirm_refund: "REFUND" }),
      );
      expectAdminRedirect(response);
    });

    test("returns 400 when confirmation text is wrong", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_bad_confirm",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_bad",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_bad_confirm/refund",
              { confirm_refund: "wrong", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(400);
          const html = await response.text();
          expect(html).toContain("Type REFUND exactly to confirm");
        },
      );
    });

    test("returns 400 when confirmation text is empty", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_empty_confirm",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_empty",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_empty_confirm/refund",
              { confirm_refund: "", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(400);
          const html = await response.text();
          expect(html).toContain("Type REFUND exactly to confirm");
        },
      );
    });

    test("issues refund and redirects on success", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      // Create product and confirmed reservation for restocking
      const product = await productsTable.insert({
        sku: "REFUND-SKU",
        name: "Refund Product",
        unitPrice: 1000,
        stock: 5,
      });
      await reserveStock(product.id, 1, "cs_test_refund_success");
      await confirmReservation("cs_test_refund_success");

      await withMocks(
        () => ({
          retrieve: spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
            id: "cs_test_refund_success",
            payment_status: "paid",
            amount_total: 1000,
            currency: "gbp",
            customer_details: null,
            created: Math.floor(Date.now() / 1000),
            url: null,
            payment_intent: "pi_test_refund_ok",
            line_items: { data: [] },
            metadata: {},
          }),
          refund: spyOn(stripeApi, "refundPayment").mockResolvedValue({
            id: "re_test_1",
          } as unknown as import("stripe").Stripe.Refund),
        }),
        async (mocks) => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_refund_success/refund",
              { confirm_refund: "REFUND", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(302);
          const location = response.headers.get("location");
          expect(location).toContain("/admin/orders/cs_test_refund_success");
          expect(location).toContain("success=");
          expect(mocks.refund).toHaveBeenCalledWith("pi_test_refund_ok");
        },
      );
    });

    test("returns 500 when refund fails", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => ({
          retrieve: spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
            id: "cs_test_refund_fail",
            payment_status: "paid",
            amount_total: 1000,
            currency: "gbp",
            customer_details: null,
            created: Math.floor(Date.now() / 1000),
            url: null,
            payment_intent: "pi_test_refund_fail",
            line_items: { data: [] },
            metadata: {},
          }),
          refund: spyOn(stripeApi, "refundPayment").mockResolvedValue(null),
        }),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_refund_fail/refund",
              { confirm_refund: "REFUND", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(500);
          const html = await response.text();
          expect(html).toContain("Refund failed");
        },
      );
    });

    test("returns 400 when no payment reference exists", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_no_ref",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: null,
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_no_ref/refund",
              { confirm_refund: "REFUND", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(400);
          const html = await response.text();
          expect(html).toContain("No payment reference found");
        },
      );
    });
  });

  describe("POST /admin/orders/:orderRef/refund (no provider)", () => {
    test("returns 400 when no provider configured and confirmation correct", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const response = await handleRequest(
        mockFormRequest(
          "/admin/orders/cs_test_noprov/refund",
          { confirm_refund: "REFUND", csrf_token: csrfToken },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Payment provider not configured");
    });

    test("returns 404 when session not found during refund", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue(null),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_gone/refund",
              { confirm_refund: "REFUND", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(404);
          const html = await response.text();
          expect(html).toContain("Order not found");
        },
      );
    });

    test("returns 400 when no provider configured and confirmation wrong", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();
      const response = await handleRequest(
        mockFormRequest(
          "/admin/orders/cs_test_noprov2/refund",
          { confirm_refund: "wrong", csrf_token: csrfToken },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Payment provider not configured");
    });

    test("returns 404 when session not found and confirmation wrong", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue(null),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_gone2/refund",
              { confirm_refund: "wrong", csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(404);
          const html = await response.text();
          expect(html).toContain("Order not found");
        },
      );
    });
  });

  describe("template coverage", () => {
    test("shows pending and expired reservation statuses", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      const product = await productsTable.insert({
        sku: "STATUS-SKU",
        name: "Status Product",
        unitPrice: 500,
        stock: 20,
      });
      await reserveStock(product.id, 1, "cs_test_statuses");
      // Create another reservation on same session - first is pending
      const product2 = await productsTable.insert({
        sku: "STATUS-SKU-2",
        name: "Status Product 2",
        unitPrice: 500,
        stock: 20,
      });
      await reserveStock(product2.id, 1, "cs_test_statuses");
      await expireReservation("cs_test_statuses");
      // Recreate pending reservation
      await reserveStock(product.id, 1, "cs_test_statuses_new");

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_statuses",
          payment_status: "expired",
          amount_total: null,
          currency: null,
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: null,
          line_items: null,
          metadata: null,
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_statuses", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Expired / Refunded");
          // Amount with null should show "-"
          expect(html).toContain("<td>-</td>");
        },
      );
    });

    test("shows detail with no line items, no metadata, no dashboard URL", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_minimal",
          payment_status: "unpaid",
          amount_total: 500,
          currency: null,
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: null,
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_minimal", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Order Detail");
          expect(html).not.toContain("Line Items");
          expect(html).not.toContain("Metadata");
          expect(html).not.toContain("Issue Refund");
          // Amount without currency
          expect(html).toContain("5.00");
        },
      );
    });

    test("renders line items with null unit price and total", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_nullprices",
          payment_status: "paid",
          amount_total: 1000,
          currency: "usd",
          customer_details: { email: "test@test.com", name: null },
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_nullprices",
          line_items: {
            data: [
              {
                description: null,
                quantity: null,
                price: null,
                amount_total: null,
              },
            ],
          },
          metadata: { key1: "val1" },
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_nullprices", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Unknown item");
          expect(html).toContain("Line Items");
        },
      );
    });

    test("shows empty date as dash", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_nodate",
          payment_status: "unpaid",
          amount_total: null,
          currency: null,
          customer_details: null,
          created: 0,
          url: null,
          payment_intent: null,
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_nodate", { cookie });
          expect(response.status).toBe(200);
        },
      );
    });
  });

  describe("template edge cases via direct rendering", () => {
    test("renders square provider name and empty date", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      // Mock the provider to return a square-type detail
      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "sq_test_edge",
          payment_status: "paid",
          amount_total: 2000,
          currency: "usd",
          customer_details: { email: "sq@test.com", name: "Square User" },
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_sq_edge",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/sq_test_edge", { cookie });
          expect(response.status).toBe(200);
        },
      );
    });

    test("renders with pending reservations", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      const product = await productsTable.insert({
        sku: "PENDING-SKU",
        name: "Pending Product",
        unitPrice: 500,
        stock: 20,
      });
      await reserveStock(product.id, 1, "cs_test_pending_res");

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_pending_res",
          payment_status: "unpaid",
          amount_total: 500,
          currency: "usd",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: null,
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders/cs_test_pending_res", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Pending");
        },
      );
    });
  });

  describe("direct template rendering", () => {
    test("formatDate handles empty created string", async () => {
      const { adminOrderDetailPage } = await import("#templates/admin/order-detail.tsx");
      const html = adminOrderDetailPage(
        {
          id: "test_empty_date",
          status: "unpaid",
          amount: null,
          currency: null,
          customerEmail: null,
          created: "",
          url: null,
          lineItems: [],
          metadata: {},
          customerName: null,
          paymentReference: null,
          dashboardUrl: null,
          providerType: "square",
        },
        [],
        { adminLevel: "owner", csrfToken: "tok" },
      );
      expect(html).toContain("Square");
      expect(html).toContain("test_empty_date");
    });
  });

  describe("refund form edge cases", () => {
    test("handles missing confirm_refund field in form", async () => {
      await setupStripe();
      const { cookie, csrfToken } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "retrieveCheckoutSessionExpanded").mockResolvedValue({
          id: "cs_test_no_field",
          payment_status: "paid",
          amount_total: 1000,
          currency: "gbp",
          customer_details: null,
          created: Math.floor(Date.now() / 1000),
          url: null,
          payment_intent: "pi_test_no_field",
          line_items: { data: [] },
          metadata: {},
        }),
        async () => {
          const response = await handleRequest(
            mockFormRequest(
              "/admin/orders/cs_test_no_field/refund",
              { csrf_token: csrfToken },
              cookie,
            ),
          );
          expect(response.status).toBe(400);
          const html = await response.text();
          expect(html).toContain("Type REFUND exactly to confirm");
        },
      );
    });
  });

  describe("orders list links", () => {
    test("order IDs link to detail page", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "listCheckoutSessions").mockResolvedValue({
          sessions: [
            {
              id: "cs_test_link_1",
              payment_status: "paid",
              amount_total: 1000,
              currency: "gbp",
              customer_details: null,
              created: Math.floor(Date.now() / 1000),
              url: null,
            },
          ],
          hasMore: false,
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders", { cookie });
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain('href="/admin/orders/cs_test_link_1"');
        },
      );
    });
  });
});
