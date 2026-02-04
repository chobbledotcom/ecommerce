import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import { handleRequest } from "#routes";
import { CONFIG_KEYS, getSetting } from "#lib/db/settings.ts";
import {
  createTestDbWithSetup,
  loginAsAdmin,
  mockFormRequest,
  resetDb,
  expectAdminRedirect,
  awaitTestRequest,
} from "#test-utils";

describe("server (settings - allowed origins and currency)", () => {
  beforeEach(async () => {
    await createTestDbWithSetup();
  });

  afterEach(() => {
    resetDb();
  });

  describe("POST /admin/settings/allowed-origins", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/settings/allowed-origins", {
          allowed_origins: "https://shop.example.com",
        }),
      );
      expectAdminRedirect(response);
    });

    test("saves allowed origins", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/allowed-origins",
          {
            allowed_origins: "https://shop.example.com,https://store.example.com",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      const location = response.headers.get("location")!;
      expect(decodeURIComponent(location)).toContain("Allowed origins updated");

      // Verify saved in DB
      const saved = await getSetting(CONFIG_KEYS.ALLOWED_ORIGINS);
      expect(saved).toBe("https://shop.example.com,https://store.example.com");
    });

    test("saves empty origins string", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/allowed-origins",
          {
            allowed_origins: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
    });

    test("rejects invalid CSRF token", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/allowed-origins",
          {
            allowed_origins: "https://shop.example.com",
            csrf_token: "invalid",
          },
          cookie,
        ),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("POST /admin/settings/currency", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/settings/currency", {
          currency_code: "USD",
        }),
      );
      expectAdminRedirect(response);
    });

    test("saves valid currency code", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/currency",
          {
            currency_code: "usd",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      const location = response.headers.get("location")!;
      expect(decodeURIComponent(location)).toContain("Currency set to USD");

      // Verify stored as uppercase
      const saved = await getSetting(CONFIG_KEYS.CURRENCY_CODE);
      expect(saved).toBe("USD");
    });

    test("rejects invalid currency code (too short)", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/currency",
          {
            currency_code: "US",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Invalid currency code");
    });

    test("rejects invalid currency code (too long)", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/currency",
          {
            currency_code: "USDD",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Invalid currency code");
    });

    test("rejects non-alpha currency code", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/currency",
          {
            currency_code: "12A",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("Invalid currency code");
    });

    test("rejects invalid CSRF token", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/currency",
          {
            currency_code: "USD",
            csrf_token: "invalid",
          },
          cookie,
        ),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("settings page shows new sections", () => {
    test("shows allowed origins field", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("allowed_origins");
    });

    test("shows currency field", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("currency");
    });
  });
});
