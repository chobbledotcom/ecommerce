/**
 * Checkout attempt tracking (rate limiting for /api/checkout)
 *
 * Prevents stock reservation abuse by limiting how many checkout sessions
 * a single IP can create within a time window. Without this, an attacker
 * could repeatedly create checkout sessions to lock up all stock for
 * 30 minutes at a time, keeping a store permanently "sold out".
 */

import { createRateLimiter } from "#lib/db/rate-limiter.ts";

const checkoutLimiter = createRateLimiter({
  table: "checkout_attempts",
  maxAttempts: 10,
  lockoutDurationMs: 30 * 60 * 1000, // 30 minutes (matches reservation expiry)
});

/** Check if IP is rate limited for checkout */
export const isCheckoutRateLimited = checkoutLimiter.isRateLimited;

/** Record a checkout attempt. Returns true if the IP is now locked out. */
export const recordCheckoutAttempt = checkoutLimiter.recordAttempt;
