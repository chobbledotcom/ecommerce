import { describe, expect, test } from "#test-compat";
import {
  createWithClient,
  safeAsync,
  toSessionListResult,
} from "#lib/payment-helpers.ts";
import { ErrorCode } from "#lib/logger.ts";

describe("payment-helpers", () => {
  describe("safeAsync", () => {
    test("returns the resolved value on success", async () => {
      const result = await safeAsync(
        () => Promise.resolve(42),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBe(42);
    });

    test("returns null on rejection", async () => {
      const result = await safeAsync(
        () => Promise.reject(new Error("boom")),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBeNull();
    });

    test("returns null when function throws a non-Error", async () => {
      const result = await safeAsync(
        () => Promise.reject("string error"),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBeNull();
    });

    test("returns complex objects on success", async () => {
      const obj = { id: "sess_1", url: "https://pay.example.com" };
      const result = await safeAsync(
        () => Promise.resolve(obj),
        ErrorCode.PAYMENT_SESSION,
      );
      expect(result).toEqual(obj);
    });
  });

  describe("createWithClient", () => {
    test("returns null when getClient resolves to null", async () => {
      const withClient = createWithClient(() => Promise.resolve(null));
      const result = await withClient(
        () => Promise.resolve("value"),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBeNull();
    });

    test("passes client to operation and returns result", async () => {
      const withClient = createWithClient(() =>
        Promise.resolve({ token: "abc" }),
      );
      const result = await withClient(
        (client) => Promise.resolve(`got-${client.token}`),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBe("got-abc");
    });

    test("returns null when operation throws", async () => {
      const withClient = createWithClient(() =>
        Promise.resolve({ token: "abc" }),
      );
      const result = await withClient(
        (_client) => Promise.reject(new Error("op failed")),
        ErrorCode.PAYMENT_CHECKOUT,
      );
      expect(result).toBeNull();
    });

  });

  describe("toSessionListResult", () => {
    test("returns empty result when items are undefined", async () => {
      const result = toSessionListResult(
        { hasMore: true },
        undefined,
        () => ({ id: "", status: "", amount: null, currency: null, customerEmail: null, created: "", url: null }),
      );
      expect(result.sessions).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });
});
