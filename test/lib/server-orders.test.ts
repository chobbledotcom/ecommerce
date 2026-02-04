import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import { handleRequest } from "#routes";
import { stripeApi } from "#lib/stripe.ts";
import {
  awaitTestRequest,
  createTestDbWithSetup,
  loginAsAdmin,
  mockRequest,
  resetDb,
  setupStripe,
  expectAdminRedirect,
  withMocks,
} from "#test-utils";

describe("server (admin orders)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("GET /admin/orders", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(mockRequest("/admin/orders"));
      expectAdminRedirect(response);
    });

    test("shows empty state when no payment provider", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/orders", { cookie });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Orders");
      expect(html).toContain("No orders yet");
    });

    test("shows orders from payment provider", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "listCheckoutSessions").mockResolvedValue({
          sessions: [
            {
              id: "cs_test_order_1",
              payment_status: "paid",
              amount_total: 2500,
              currency: "gbp",
              customer_details: { email: "customer@example.com" },
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
          expect(html).toContain("Orders");
          expect(html).toContain("cs_test_order_1");
          expect(html).toContain("customer@example.com");
        },
      );
    });

    test("shows pagination link when more orders available", async () => {
      await setupStripe();
      const { cookie } = await loginAsAdmin();

      await withMocks(
        () => spyOn(stripeApi, "listCheckoutSessions").mockResolvedValue({
          sessions: [
            {
              id: "cs_test_last",
              payment_status: "paid",
              amount_total: 1000,
              currency: "gbp",
              customer_details: null,
              created: Math.floor(Date.now() / 1000),
              url: null,
            },
          ],
          hasMore: true,
        }),
        async () => {
          const response = await awaitTestRequest("/admin/orders", { cookie });
          const html = await response.text();
          expect(html).toContain("Next page");
          expect(html).toContain("after=");
        },
      );
    });
  });
});
