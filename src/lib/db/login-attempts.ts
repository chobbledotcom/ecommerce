/**
 * Login attempts table operations (rate limiting)
 */

import { createRateLimiter } from "#lib/db/rate-limiter.ts";

const loginLimiter = createRateLimiter({
  table: "login_attempts",
  maxAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
});

/** Check if IP is rate limited for login */
export const isLoginRateLimited = loginLimiter.isRateLimited;

/** Record a failed login attempt. Returns true if the account is now locked. */
export const recordFailedLogin = loginLimiter.recordAttempt;

/** Clear login attempts for an IP (on successful login) */
export const clearLoginAttempts = loginLimiter.clearAttempts;
