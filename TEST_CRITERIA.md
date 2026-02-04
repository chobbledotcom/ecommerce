# Test Quality Criteria

All tests in this project must meet these criteria. These rules are enforced both by human review and by automated checks in `test/lib/code-quality.test.ts`.

## 1. Tests Production Code, Not Reimplementations

- Import and call actual production functions — never copy-paste or reimplement production logic in tests.
- Import constants from production code when they are already exported for production use (e.g. `CONFIG_KEYS` from `#lib/db/settings.ts`).
- Do NOT export constants solely for test consumption — the `code-quality.test.ts` "no test-only exports" rule will reject this. If a constant is internal to a module, test the behaviour it controls rather than importing the value.

```typescript
// GOOD: test the behaviour the constant controls
let locked = false;
while (!locked) {
  locked = await recordFailedLogin(ip);
}
expect(await isLoginRateLimited(ip)).toBe(true);

// BAD: exporting MAX_LOGIN_ATTEMPTS just so a test can loop exactly that many times
import { MAX_LOGIN_ATTEMPTS } from "#lib/db/login-attempts.ts";
for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) { ... }
```

## 2. Not Tautological

- Never assert a value you just set (`expect(true).toBe(true)`).
- Never assert that a constant equals its own literal value (`expect(ErrorCode.FOO).toBe("E_FOO")`).
- Always have **production code execution** between setup and assertion.
- Verify behaviour, not that JavaScript assignment works.

```typescript
// BAD: tests nothing
expect(CONFIG_KEYS.CURRENCY_CODE).toBe("currency_code");

// GOOD: tests that CONFIG_KEYS values actually work as DB keys
for (const key of Object.values(CONFIG_KEYS)) {
  await setSetting(key, "test-value");
  expect(await getSetting(key)).toBe("test-value");
}
```

## 3. Black-Box Behaviour via the HTTP API

This is a server application. Prefer testing through the public HTTP interface over importing and calling internal functions directly.

- Use `handleRequest(mockRequest(...))` or `awaitTestRequest(...)` to exercise routes end-to-end.
- Assert on **observable outcomes**: HTTP status codes, response body content, `Set-Cookie` headers, database state after the request.
- A refactor of internal modules should not break tests unless the HTTP behaviour changes.
- Do not assert on CSS class names, HTML element structure, or internal variable values when you can assert on user-visible content instead.

```typescript
// GOOD: tests the HTTP contract
const response = await handleRequest(mockFormRequest("/admin/login", { username: "admin", password: "wrong" }));
expect(response.status).toBe(401);
expect(await response.text()).toContain("Invalid credentials");

// LESS GOOD: tests an internal function directly when an HTTP test would cover it
const result = verifyPassword(hash, "wrong");
expect(result).toBeNull();
```

DB-level tests (e.g. `products.test.ts`, `reservations.test.ts`) are appropriate when testing data-layer logic that has no direct HTTP route, or when an HTTP test would be too indirect to isolate a specific data behaviour.

## 4. Has Clear Failure Semantics

- Test names describe the **specific behaviour** being verified: "rejects password shorter than minimum length", not "validates form".
- When a test fails, it should be immediately obvious what is broken.
- Avoid generic names like "works correctly" or "handles edge cases".

## 5. Isolated and Repeatable

- Tests clean up after themselves using `beforeEach` / `afterEach` with `createTestDb()` or `createTestDbWithSetup()` and `resetDb()`.
- Tests must not depend on other tests running first.
- No time-dependent flakiness — use `jest.useFakeTimers()` when testing time-sensitive logic.

## 6. Tests One Thing

- Each test has a single reason to fail.
- If you need "and" in the description, split the test.

```typescript
// BAD: tests three things
test("changes password and invalidates session and new password works", async () => { ... });

// GOOD: three focused tests
test("changes password and redirects with session cleared", async () => { ... });
test("old session is invalidated after password change", async () => { ... });
test("new password works after password change", async () => { ... });
```

## Coverage

100% line coverage is required. Run:

```bash
deno task test:coverage
```

## Test Utilities

Use helpers from `#test-utils` — do not redefine them locally.

```typescript
import {
  mockRequest, mockFormRequest, awaitTestRequest,
  createTestDb, createTestDbWithSetup, resetDb,
  loginAsAdmin, getTestSession,
  createTestProduct,
  expectStatus, expectRedirect, expectAdminRedirect,
  expectValid, expectInvalid, expectInvalidForm,
  TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD,
} from "#test-utils";
```

## Anti-Patterns

| Anti-Pattern | What To Do Instead |
|---|---|
| `expect(CONST).toBe("literal")` | Test the behaviour the constant controls |
| Reimplementing production logic in tests | Import and call production code |
| Duplicating test helpers locally | Use `#test-utils` |
| Exporting a constant just for tests | Test the behaviour, or add to `ALLOWED_TEST_HOOKS` if genuinely needed for test setup |
| Testing internal function when HTTP test works | Use `handleRequest()` / `awaitTestRequest()` |
| Asserting on CSS classes or HTML structure | Assert on user-visible text content |
| Raw SQL in tests when a production function exists | Call the production function |
| `for (let i = 0; i < MAGIC_NUMBER; i++)` | Loop until the behavioural condition is met |
| Multiple assertions testing different behaviours | Split into separate `test()` blocks |
