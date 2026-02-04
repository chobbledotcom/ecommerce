import { afterEach, beforeEach, describe, expect, spyOn, test } from "#test-compat";
import {
  createRequestTimer,
  ErrorCode,
  logDebug,
  logError,
  logRequest,
  redactPath,
} from "#lib/logger.ts";

describe("logger", () => {
  describe("redactPath", () => {
    test("redacts numeric IDs in admin paths", () => {
      expect(redactPath("/admin/events/123")).toBe("/admin/events/[id]");
    });

    test("redacts multiple numeric IDs", () => {
      expect(redactPath("/admin/events/123/attendees/456")).toBe(
        "/admin/events/[id]/attendees/[id]",
      );
    });

    test("preserves paths without dynamic segments", () => {
      expect(redactPath("/admin")).toBe("/admin");
      expect(redactPath("/admin/events")).toBe("/admin/events");
      expect(redactPath("/setup")).toBe("/setup");
      expect(redactPath("/")).toBe("/");
    });

    test("preserves payment paths", () => {
      expect(redactPath("/payment/success")).toBe("/payment/success");
      expect(redactPath("/payment/webhook")).toBe("/payment/webhook");
    });

    test("handles trailing slashes with IDs", () => {
      expect(redactPath("/admin/events/123/")).toBe("/admin/events/[id]/");
    });
  });

  describe("logRequest", () => {
    let debugSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      debugSpy = spyOn(console, "debug");
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    test("logs request with redacted path", () => {
      logRequest({
        method: "GET",
        path: "/admin/products/42",
        status: 200,
        durationMs: 42,
      });

      expect(debugSpy).toHaveBeenCalledWith(
        "[Request] GET /admin/products/[id] 200 42ms",
      );
    });

    test("logs POST request", () => {
      logRequest({
        method: "POST",
        path: "/admin/events/123",
        status: 201,
        durationMs: 100,
      });

      expect(debugSpy).toHaveBeenCalledWith(
        "[Request] POST /admin/events/[id] 201 100ms",
      );
    });

    test("logs error status codes", () => {
      logRequest({
        method: "GET",
        path: "/admin",
        status: 403,
        durationMs: 5,
      });

      expect(debugSpy).toHaveBeenCalledWith("[Request] GET /admin 403 5ms");
    });
  });

  describe("logError", () => {
    let errorSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      errorSpy = spyOn(console, "error");
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    test("logs error code only", () => {
      logError({ code: ErrorCode.DB_CONNECTION });

      expect(errorSpy).toHaveBeenCalledWith("[Error] E_DB_CONNECTION");
    });

    test("logs error with detail", () => {
      logError({ code: ErrorCode.STRIPE_SIGNATURE, detail: "mismatch" });

      expect(errorSpy).toHaveBeenCalledWith(
        '[Error] E_STRIPE_SIGNATURE detail="mismatch"',
      );
    });

    test("logs error with code and detail", () => {
      logError({
        code: ErrorCode.NOT_FOUND_PRODUCT,
        detail: "inactive",
      });

      expect(errorSpy).toHaveBeenCalledWith(
        '[Error] E_NOT_FOUND_PRODUCT detail="inactive"',
      );
    });
  });

  describe("logDebug", () => {
    let debugSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      debugSpy = spyOn(console, "debug");
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    test("logs with Setup category", () => {
      logDebug("Setup", "Validation passed");

      expect(debugSpy).toHaveBeenCalledWith("[Setup] Validation passed");
    });

    test("logs with Webhook category", () => {
      logDebug("Webhook", "Sending notification");

      expect(debugSpy).toHaveBeenCalledWith("[Webhook] Sending notification");
    });

    test("logs with Stripe category", () => {
      logDebug("Stripe", "Creating checkout session");

      expect(debugSpy).toHaveBeenCalledWith("[Stripe] Creating checkout session");
    });
  });

  describe("createRequestTimer", () => {
    test("returns elapsed time in milliseconds", async () => {
      const getElapsed = createRequestTimer();

      // Wait a small amount
      await new Promise((resolve) => setTimeout(resolve, 10));

      const elapsed = getElapsed();
      expect(elapsed).toBeGreaterThanOrEqual(10);
      expect(elapsed).toBeLessThan(100); // Sanity check
    });

    test("returns integer values", () => {
      const getElapsed = createRequestTimer();
      const elapsed = getElapsed();

      expect(Number.isInteger(elapsed)).toBe(true);
    });
  });

  describe("ErrorCode usage", () => {
    let errorSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      errorSpy = spyOn(console, "error");
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    test("all error codes produce correctly prefixed log output", () => {
      for (const key of Object.keys(ErrorCode)) {
        const code = ErrorCode[key as keyof typeof ErrorCode];
        logError({ code });
        expect(errorSpy).toHaveBeenCalledWith(`[Error] ${code}`);
        errorSpy.mockClear();
      }
    });

    test("error codes start with E_ prefix", () => {
      for (const key of Object.keys(ErrorCode)) {
        const code = ErrorCode[key as keyof typeof ErrorCode];
        expect(code.startsWith("E_")).toBe(true);
      }
    });
  });
});
