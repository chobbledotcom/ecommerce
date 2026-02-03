import { describe, expect, test } from "#test-compat";
import { adminDashboardPage } from "#templates/admin/dashboard.tsx";
import { adminLoginPage } from "#templates/admin/login.tsx";
import { adminGlobalActivityLogPage } from "#templates/admin/activityLog.tsx";
import { Breadcrumb } from "#templates/admin/nav.tsx";
import { adminSessionsPage } from "#templates/admin/sessions.tsx";
import { adminSettingsPage } from "#templates/admin/settings.tsx";

const TEST_CSRF_TOKEN = "test-csrf-token-abc123";
const TEST_SESSION = { csrfToken: TEST_CSRF_TOKEN, adminLevel: "owner" as const };

describe("html", () => {
  describe("adminLoginPage", () => {
    test("renders login form", () => {
      const html = adminLoginPage();
      expect(html).toContain("Login");
      expect(html).toContain('action="/admin/login"');
      expect(html).toContain('type="password"');
    });

    test("shows error when provided", () => {
      const html = adminLoginPage("Invalid password");
      expect(html).toContain("Invalid password");
      expect(html).toContain('class="error"');
    });

    test("escapes error message", () => {
      const html = adminLoginPage("<script>evil()</script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("adminDashboardPage", () => {
    test("renders dashboard page with nav", () => {
      const html = adminDashboardPage(TEST_SESSION);
      expect(html).toContain("Dashboard");
      expect(html).toContain("Events");
    });

    test("includes logout link", () => {
      const html = adminDashboardPage(TEST_SESSION);
      expect(html).toContain("/admin/logout");
    });
  });

  describe("adminGlobalActivityLogPage", () => {
    test("renders global activity log with entries", () => {
      const entries = [
        { id: 1, created: "2024-01-15T10:30:00Z", event_id: null, message: "System started" },
      ];
      const html = adminGlobalActivityLogPage(entries);
      expect(html).toContain("System started");
      expect(html).toContain("Log");
    });

    test("renders empty state when no entries", () => {
      const html = adminGlobalActivityLogPage([]);
      expect(html).toContain("No activity recorded yet");
    });

    test("shows truncation message when truncated", () => {
      const entries = [
        { id: 1, created: "2024-01-15T10:30:00Z", event_id: null, message: "Action" },
      ];
      const html = adminGlobalActivityLogPage(entries, true);
      expect(html).toContain("Showing the most recent 200 entries");
    });

    test("does not show truncation message when not truncated", () => {
      const entries = [
        { id: 1, created: "2024-01-15T10:30:00Z", event_id: null, message: "Action" },
      ];
      const html = adminGlobalActivityLogPage(entries, false);
      expect(html).not.toContain("Showing the most recent 200 entries");
    });
  });

  describe("Breadcrumb", () => {
    test("renders breadcrumb link with label", () => {
      const html = String(Breadcrumb({ href: "/admin/", label: "Back to Events" }));
      expect(html).toContain('href="/admin/"');
      expect(html).toContain("Back to Events");
      expect(html).toContain("\u2190");
    });
  });

  describe("adminSessionsPage", () => {
    test("renders session rows", () => {
      const sessions = [
        { token: "abcdefghijklmnop", csrf_token: "csrf1", expires: Date.now() + 86400000, wrapped_data_key: null, user_id: 1 },
        { token: "qrstuvwxyz123456", csrf_token: "csrf2", expires: Date.now() + 86400000, wrapped_data_key: null, user_id: 2 },
      ];
      const html = adminSessionsPage(sessions, "abcdefghijklmnop", TEST_SESSION);
      expect(html).toContain("abcdefgh...");
      expect(html).toContain("qrstuvwx...");
      expect(html).toContain("Current");
    });

    test("renders empty state when no sessions", () => {
      const html = adminSessionsPage([], "some-token", TEST_SESSION);
      expect(html).toContain("No sessions");
    });
  });

  describe("adminSettingsPage", () => {
    test("shows square webhook configured message when key is set", () => {
      const html = adminSettingsPage(
        TEST_SESSION,
        false, // stripeKeyConfigured
        "square", // paymentProvider
        undefined, // error
        undefined, // success
        true, // squareTokenConfigured
        true, // squareWebhookConfigured
        "https://example.com/payment/webhook",
      );
      expect(html).toContain("A webhook signature key is currently configured");
      expect(html).toContain("Enter a new key below to replace it");
    });

    test("shows fallback text when webhookUrl is not provided", () => {
      const html = adminSettingsPage(
        TEST_SESSION,
        false, // stripeKeyConfigured
        "square", // paymentProvider
        undefined, // error
        undefined, // success
        true, // squareTokenConfigured
        false, // squareWebhookConfigured
        undefined, // webhookUrl is undefined
      );
      expect(html).toContain("(configure ALLOWED_DOMAIN first)");
    });

    test("shows square webhook not configured message when key is not set", () => {
      const html = adminSettingsPage(
        TEST_SESSION,
        false,
        "square",
        undefined,
        undefined,
        true,
        false, // squareWebhookConfigured = false
        "https://example.com/payment/webhook",
      );
      expect(html).toContain("No webhook signature key is configured");
      expect(html).toContain("Follow the steps above to set one up");
    });
  });
});
