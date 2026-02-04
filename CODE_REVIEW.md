# Code Review Analysis

## Overall Assessment

Well-built system with strong security fundamentals and coherent architecture. The issues below are ordered from most to least concerning.

---

## Critical Issues

### 1. SQL Interpolation in `transitionStatus()`

**File:** `src/lib/db/reservations.ts:86`

```typescript
sql: `UPDATE stock_reservations SET status = '${newStatus}' WHERE ${whereClause}`,
```

Both `newStatus` and `whereClause` are interpolated directly into SQL. Currently safe because callers pass hardcoded strings, but this is the kind of pattern that becomes a vulnerability on refactor. Every other query in the codebase uses parameterized queries — this one is the exception.

### 2. Race Condition in Multi-Item Checkout

**File:** `src/routes/api.ts:128-142`

Stock reservations happen one-by-one in a loop, each as an individual INSERT with a WHERE-subquery availability check. Two concurrent checkouts for the last available units can both succeed because neither INSERT is visible to the other's availability check under SQLite's default isolation. The entire reservation loop should be wrapped in a transaction.

---

## Significant Issues

### 3. `constantTimeEqual` Short-Circuits on Length

**File:** `src/lib/crypto.ts:13-15`

The function returns `false` immediately when lengths differ, leaking the expected value's length. For fixed-length tokens this is mostly harmless, but the function name promises constant-time behavior it doesn't deliver. A proper implementation would hash both inputs to a fixed length before comparing.

### 4. Session Cache Has No Size Limit

**File:** `src/lib/db/sessions.ts:16-17`

The session cache is an unbounded `Map`. Entries expire after 10s but are only evicted on lookup. A credential-stuffing attack with many distinct tokens grows this map without limit — a memory leak / DoS vector. Should use an LRU cache with a max size.

### 5. No Stale Reservation Cleanup

`expireStaleReservations()` exists but nothing calls it on a schedule. If a checkout is created but the webhook never fires (network failure, provider outage), those pending reservations permanently reduce available stock.

### 6. Square Webhook Events Hardcoded as Stripe

**File:** `src/routes/webhooks.ts:133-151`

The expiry and refund event handlers check Stripe-specific event types (`checkout.session.expired`, `charge.refunded`) regardless of which provider is active. When Square is active, expired checkouts and refunds are silently ignored. Only the completion event uses the provider-agnostic `provider.checkoutCompletedEventType`.

---

## Moderate Issues

### 7. Dynamic Import for No Reason

**File:** `src/routes/api.ts:169`

```typescript
const { getDb } = await import("#lib/db/client.ts");
```

`getDb` is already reachable through the module's existing imports. This dynamic import is unnecessary, confusing, and bypasses the reservation module's abstraction by writing raw SQL against its table.

### 8. `withCookie` Overwrites Existing Cookies

**File:** `src/routes/utils.ts:232`

Uses `headers.set("set-cookie", cookie)` which replaces any existing `set-cookie` header. Should use `headers.append()`. Currently doesn't cause bugs because code paths don't overlap, but it's a latent issue.

### 9. Migration System Swallows All Errors

**File:** `src/lib/db/migrations/index.ts:17-23`

`runMigration()` catches and ignores all errors, not just "already applied" errors. Disk full, permissions, SQL syntax errors — all silently ignored. The processed_payments table drop-and-recreate migration could lose data on partial failure.

### 10. No Request Size Limits

`request.json()` and `request.text()` are called without size limits in `api.ts:99`, `webhooks.ts:96`, and `utils.ts:188`. An attacker can send a multi-gigabyte body to exhaust memory.

### 11. Missing `Vary: Origin` on CORS Responses

**File:** `src/routes/middleware.ts:152-163`

CORS responses set `access-control-allow-origin` to the request's origin but don't include `Vary: Origin`. Intermediary caches may serve Origin A's CORS headers to Origin B.

---

## Design / Style Issues

### 12. FP Utilities Used Inconsistently

The curried FP functions (`map`, `filter` from `#fp`) make sense inside `pipe()` chains. Used standalone, they add verbosity:

```typescript
// This is harder to read than items.map(i => i.sku)
const skus = map((i: CartItem) => i.sku)(items);
```

The codebase mixes standalone curried calls with normal `for` loops. A clearer convention: use `#fp` functions in `pipe()`, use native methods for standalone calls.

### 13. `mapAsync` Is Sequential But Named Generic

**File:** `src/fp/index.ts:310-318`

`mapAsync` processes items one-at-a-time (sequential `await` in a loop). The name doesn't communicate this. `mapSequential` would be clearer. There's no parallel alternative for I/O-bound operations.

### 14. `memoize` Uses `JSON.stringify` With No Eviction

**File:** `src/fp/index.ts:150-160`

Cache key is `JSON.stringify(args)` — fails for `undefined`, functions, circular refs, `BigInt`. No cache size limit. Unbounded memory growth for functions called with many distinct arguments.

### 15. RSA 2048-bit Is the Floor

**File:** `src/lib/crypto.ts:619`

2048-bit RSA is the minimum acceptable size. NIST recommends 3072+ for use beyond 2030. Since key generation is a one-time setup operation, 4096-bit has negligible cost.

### 16. Settings Table Is Untyped Key-Value

The settings table stores everything as `key TEXT → value TEXT` with no schema enforcement. `CONFIG_KEYS` provides some structure, but nothing prevents reading/writing arbitrary keys. A typed approach (one column per setting, or validated schema) would catch errors at compile time.

---

## Things Done Well

- **Key hierarchy** (DB_ENCRYPTION_KEY → KEK → DATA_KEY → Private Key) is textbook correct
- **Session tokens hashed before storage** prevents DB-breach session hijacking
- **CSRF validation integral to form parsing** — you can't get form data without validating CSRF
- **Lazy-loading routes** for edge cold-start optimization
- **Parameterized queries** used consistently (one exception above)
- **Rate limiting on login** with HMAC'd IP addresses
- **`__Host-` cookie prefix** prevents subdomain attacks
- **Idempotent webhook processing** with two-phase locking
- **Atomic stock reservation** SQL (individual operations)
- **100% test coverage** with black-box HTTP-level tests
- **`code-quality.test.ts`** preventing test-only exports in production
