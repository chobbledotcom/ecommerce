import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import { handleRequest } from "#routes";
import { decrypt } from "#lib/crypto.ts";
import { CONFIG_KEYS, getSetting, setSetting } from "#lib/db/settings.ts";
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
      expect(html).toContain("Currency code must be 3 uppercase letters");
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
      expect(html).toContain("Currency code must be 3 uppercase letters");
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
      expect(html).toContain("Currency code must be 3 uppercase letters");
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

    test("shows current allowed origins value in textarea", async () => {
      await setSetting(CONFIG_KEYS.ALLOWED_ORIGINS, "https://shop.example.com,https://store.example.com");
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("https://shop.example.com,https://store.example.com");
    });

    test("shows currency field", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("currency");
    });

    test("shows outbound webhook fields", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("Order Webhook");
      expect(html).toContain("webhook_url");
      expect(html).toContain("webhook_secret");
    });

    test("shows configured webhook URL on settings page", async () => {
      await setSetting(CONFIG_KEYS.WEBHOOK_URL, "https://fulfillment.example.com/hook");
      const { cookie } = await loginAsAdmin();

      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("https://fulfillment.example.com/hook");
    });
  });

  describe("POST /admin/settings/outbound-webhook", () => {
    test("redirects to login when not authenticated", async () => {
      const response = await handleRequest(
        mockFormRequest("/admin/settings/outbound-webhook", {
          webhook_url: "https://example.com/hook",
        }),
      );
      expectAdminRedirect(response);
    });

    test("saves webhook URL", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/outbound-webhook",
          {
            webhook_url: "https://fulfillment.example.com/orders",
            webhook_secret: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);
      const location = response.headers.get("location")!;
      expect(decodeURIComponent(location)).toContain("Outbound webhook settings updated");

      const saved = await getSetting(CONFIG_KEYS.WEBHOOK_URL);
      expect(saved).toBe("https://fulfillment.example.com/orders");
    });

    test("saves webhook secret encrypted", async () => {
      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/outbound-webhook",
          {
            webhook_url: "https://example.com/hook",
            webhook_secret: "my_super_secret",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);

      // Verify secret is stored encrypted (not plaintext)
      const raw = await getSetting(CONFIG_KEYS.WEBHOOK_SECRET);
      expect(raw).not.toBeNull();
      expect(raw).not.toBe("my_super_secret");

      // Verify it decrypts back correctly
      const decrypted = await decrypt(raw!);
      expect(decrypted).toBe("my_super_secret");
    });

    test("clears webhook URL when left blank", async () => {
      // Set a URL first
      await setSetting(CONFIG_KEYS.WEBHOOK_URL, "https://old.example.com/hook");

      const { cookie, csrfToken } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/outbound-webhook",
          {
            webhook_url: "",
            webhook_secret: "",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );
      expect(response.status).toBe(302);

      const saved = await getSetting(CONFIG_KEYS.WEBHOOK_URL);
      expect(saved).toBeNull();
    });

    test("rejects invalid CSRF token", async () => {
      const { cookie } = await loginAsAdmin();

      const response = await handleRequest(
        mockFormRequest(
          "/admin/settings/outbound-webhook",
          {
            webhook_url: "https://example.com/hook",
            webhook_secret: "secret",
            csrf_token: "invalid",
          },
          cookie,
        ),
      );
      expect(response.status).toBe(403);
    });

    test("shows configured secret message on settings page", async () => {
      // First, set the webhook secret via the form
      const { cookie, csrfToken } = await loginAsAdmin();
      await handleRequest(
        mockFormRequest(
          "/admin/settings/outbound-webhook",
          {
            webhook_url: "https://example.com/hook",
            webhook_secret: "test_secret_val",
            csrf_token: csrfToken,
          },
          cookie,
        ),
      );

      // Now render the settings page — should show "signing secret is configured"
      const response = await awaitTestRequest("/admin/settings", { cookie });
      const html = await response.text();
      expect(html).toContain("A signing secret is configured");
    });
  });
});
