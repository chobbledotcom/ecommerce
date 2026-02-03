# Implementation Plan: Ecommerce Backend

Replace the ticket reservation system with a minimal ecommerce checkout backend.
The backend is the source of truth for product catalog and stock levels, connects
to a static site for the storefront, and delegates all order/customer data
storage to Stripe.

## Design Principles

- **Backend owns products and stock** — the static site fetches catalog from the API
- **Stripe owns orders and customers** — we store only `stripe_session_id` in our
  stock reservations table, and query Stripe's API for everything else
- **No PII in our database** — no customer names, emails, or addresses stored locally
- **No encryption needed** — the only sensitive value is the Stripe secret key
  (stored as a Bunny native secret env var, not in the DB)
- **Stateless checkout flow** — reserve stock → create Stripe session → confirm on
  webhook → release on expiry/cancel

## Architecture Overview

```
Static Site (your domain)
    │
    ├── GET  /api/products          ← fetch catalog + stock at build time & page load
    ├── POST /api/checkout          ← submit cart, get Stripe Checkout URL
    │
    └── Stripe Checkout (hosted)
            │
            ├── success → redirect to static site /order-complete/
            └── webhook → POST /api/webhook/stripe
                              │
                              ├── checkout.session.completed → confirm reservation
                              ├── checkout.session.expired   → release reservation
                              └── charge.refunded            → restock
```

## Database Schema

Three tables. That's it.

```sql
-- Product catalog (source of truth for prices and stock)
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    unit_price INTEGER NOT NULL,          -- in smallest currency unit (pence/cents)
    stock INTEGER NOT NULL DEFAULT 0,     -- 0 = out of stock, -1 = unlimited
    active INTEGER NOT NULL DEFAULT 1,    -- 0 = hidden from catalog
    image_url TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL
);

-- Stock reservations (tracks in-flight checkout sessions)
CREATE TABLE stock_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    stripe_session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | expired
    created TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_reservations_session ON stock_reservations(stripe_session_id);
CREATE INDEX idx_reservations_status ON stock_reservations(status, created);

-- Settings (admin password hash, webhook config)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Stock Reservation Flow

1. `POST /api/checkout` — for each cart item, atomically:
   ```sql
   -- Check available stock (total - pending/confirmed reservations)
   -- If sufficient, INSERT into stock_reservations with status='pending'
   ```
2. `checkout.session.completed` webhook → UPDATE reservation status to `confirmed`
3. `checkout.session.expired` webhook → UPDATE reservation status to `expired`
4. Periodic cleanup: expire `pending` reservations older than 30 minutes
   (Stripe sessions expire after 24h by default, but we can be more aggressive)

### Why `unit_price` Is in Smallest Currency Unit (Integer)

The old version stores prices as floats (`10.0`, `25.5`) and does `Math.round(price * 100)`
before sending to Stripe. This is a classic floating-point bug waiting to happen.
We store prices as integers (pence/cents) and avoid the problem entirely. The API
returns prices in both formats for convenience.

## Endpoints

### Public API (CORS-enabled for static site)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/products` | Product catalog (active products with stock levels) |
| `POST` | `/api/checkout` | Validate cart, reserve stock, create Stripe session |
| `GET` | `/health` | Status + configured providers |

### Webhook (Stripe signature verified)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/webhook/stripe` | Handle checkout.session.completed/expired, charge.refunded |

### Admin (session auth, HTML UI)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin` | Dashboard — product list with stock levels |
| `POST` | `/admin/login` | Authenticate |
| `GET` | `/admin/logout` | Clear session |
| `POST` | `/admin/product/new` | Create product |
| `GET` | `/admin/product/:id/edit` | Edit form |
| `POST` | `/admin/product/:id` | Update product |
| `POST` | `/admin/product/:id/delete` | Delete product |
| `GET` | `/admin/orders` | List recent orders (fetched from Stripe API) |
| `GET` | `/admin/orders/:sessionId` | Order detail (fetched from Stripe API) |
| `POST` | `/admin/settings/password` | Change admin password |

### Setup

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/setup` | Initial admin password setup form |
| `POST` | `/setup` | Create admin user |

## Environment Variables (Bunny Native Secrets)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DB_URL` | Yes | libsql database URL |
| `DB_TOKEN` | For remote DB | Database auth token |
| `ALLOWED_ORIGINS` | Yes | Comma-separated allowed origins (e.g. `https://myshop.com,https://www.myshop.com`) |
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `CURRENCY` | No | ISO 4217 code (default: `GBP`) |
| `PORT` | No | Server port (default: `3000`, local dev only) |

Note: compared to the old version, we no longer need `BRAND_NAME` (Stripe shows the
business name from your Stripe account), `PAYPAL_*` (dropping PayPal for v1), or
`SITE_HOST` (replaced by `ALLOWED_ORIGINS` which is more explicit). We no longer
need `DB_ENCRYPTION_KEY` or `ALLOWED_DOMAIN` from the tickets app since we're not
storing PII and CORS replaces domain validation.

---

# Step 1: Delete Unneeded Code

Remove everything related to the ticket reservation system that won't be reused.

## Keep (reuse as-is or with minor changes)

| File | Reason |
|------|--------|
| `src/fp/index.ts` | FP utilities — used throughout |
| `src/lib/db/client.ts` | libsql wrapper (`getDb`, `queryOne`, `queryBatch`, etc.) |
| `src/lib/db/table.ts` | Generic table abstraction (`defineTable`, `col.*`) |
| `src/routes/router.ts` | Declarative router with pattern matching |
| `src/routes/health.ts` | Health check (will extend to report Stripe status) |
| `src/test-utils/test-compat.ts` | Jest-like test API on Deno |
| `src/index.ts` | Entry point (simplify — remove encryption key validation) |
| `src/edge/bunny-script.ts` | Edge runtime compat |

## Keep but modify significantly

| File | Changes needed |
|------|---------------|
| `src/lib/db/migrations/index.ts` | Replace all tables with: products, stock_reservations, settings |
| `src/routes/index.ts` | Replace route tree — remove ticket/checkin/join routes, add product API + checkout |
| `src/routes/middleware.ts` | Replace domain validation with CORS; keep security headers; all POST endpoints accept JSON |
| `src/lib/config.ts` | Simplify to env-only config (ALLOWED_ORIGINS, STRIPE_SECRET_KEY, CURRENCY, etc.) |
| `src/test-utils/index.ts` | Simplify — remove encryption setup, attendee helpers; add product/cart helpers |

## Delete entirely

| Path | What it was |
|------|-------------|
| `src/lib/crypto.ts` | Encryption/hashing (no PII to encrypt) |
| `src/lib/payment-crypto.ts` | Payment-related crypto |
| `src/lib/payments.ts` | Provider-agnostic payment abstraction (overkill for Stripe-only) |
| `src/lib/payment-helpers.ts` | Payment helper utilities |
| `src/lib/stripe-provider.ts` | Stripe PaymentProvider impl (replace with direct Stripe usage) |
| `src/lib/stripe.ts` | Stripe SDK wrapper (rewrite for checkout-only use case) |
| `src/lib/square.ts` | Square integration |
| `src/lib/square-provider.ts` | Square PaymentProvider impl |
| `src/lib/forms.tsx` | Form validation (admin forms will be simpler) |
| `src/lib/slug.ts` | Slug generation (products use SKU, not slugs) |
| `src/lib/qr.ts` | QR code generation |
| `src/lib/webhook.ts` | Webhook notification forwarding |
| `src/lib/env.ts` | Environment helpers (if ticket-specific) |
| `src/lib/logger.ts` | Structured error logger (simplify inline) |
| `src/lib/types.ts` | Ticket-specific types |
| `src/lib/db/events.ts` | Events table operations |
| `src/lib/db/attendees.ts` | Attendee operations |
| `src/lib/db/sessions.ts` | Admin session management (rewrite simplified) |
| `src/lib/db/users.ts` | Multi-user admin (single admin only) |
| `src/lib/db/activityLog.ts` | Activity logging |
| `src/lib/db/login-attempts.ts` | Login rate limiting |
| `src/lib/db/processed-payments.ts` | Payment idempotency (replaced by stock_reservations) |
| `src/lib/db/settings.ts` | Settings table (rewrite — simpler, no encryption) |
| `src/lib/rest/` | REST resource abstraction |
| `src/lib/jsx/` | JSX runtime (keep only if admin pages use JSX) |
| `src/routes/public.ts` | Ticket registration pages |
| `src/routes/webhooks.ts` | Payment webhook handling (rewrite for ecommerce) |
| `src/routes/checkin.ts` | Check-in routes |
| `src/routes/join.ts` | Invite acceptance |
| `src/routes/setup.ts` | Setup flow (rewrite simplified) |
| `src/routes/tickets.ts` | Ticket display |
| `src/routes/token-utils.ts` | Ticket token utilities |
| `src/routes/static.ts` | Static file serving |
| `src/routes/assets.ts` | Asset handling |
| `src/routes/admin/` | Entire admin directory (rewrite) |
| `src/templates/` | All JSX templates (rewrite) |
| `src/static/` | CSS and favicon |
| `src/config/asset-paths.ts` | Asset path config |
| `src/types/` | Type declarations |
| `src/test-utils/stripe-mock.ts` | Stripe mock (rewrite for new API shape) |
| `test/` | All existing tests (rewrite for new functionality) |

## Procedure

1. Create a fresh branch state by deleting all files in `src/` except:
   - `src/fp/index.ts`
   - `src/lib/db/client.ts`
   - `src/lib/db/table.ts`
   - `src/routes/router.ts`
   - `src/test-utils/test-compat.ts`
   - `src/edge/bunny-script.ts`
2. Delete all files in `test/`
3. Update `deno.json` imports: remove `#jsx`, `#templates`, `#static`, `square`,
   `qrcode`; keep `#fp`, `#test-compat`, `#test-utils`, `#lib`, `#routes`,
   `@libsql/client`, `stripe`, `esbuild`, `@bunny.net/edgescript-sdk`
4. Commit: "Remove ticket reservation system, keep reusable infrastructure"

---

# Step 2: Turn Events Into Products

Build the product catalog and stock management system, reusing the table
abstraction from the tickets app.

## 2.1 Database Schema (`src/lib/db/migrations/index.ts`)

Rewrite migrations to create:
- `products` table (see schema above)
- `stock_reservations` table
- `settings` table

Keep the same migration pattern (idempotent `runMigration`, version tracking
via `latest_db_update` setting).

## 2.2 Products Table (`src/lib/db/products.ts`)

Use `defineTable` from `table.ts`:

```typescript
export const productsTable = defineTable<Product, ProductInput>({
  name: "products",
  primaryKey: "id",
  schema: {
    id: col.generated<number>(),
    sku: col.simple<string>(),
    name: col.simple<string>(),
    description: col.withDefault(() => ""),
    unit_price: col.simple<number>(),      // in pence/cents
    stock: col.withDefault(() => 0),
    active: col.withDefault(() => 1),
    image_url: col.withDefault(() => ""),
    created: col.withDefault(() => new Date().toISOString()),
  },
});
```

Operations needed:
- `getAllActiveProducts()` — for the public API (active=1, ordered by name)
- `getAllProducts()` — for admin (all products, ordered by created DESC)
- `getProductBySku(sku)` — for cart validation
- `getProductsBySkus(skus[])` — batch fetch for checkout validation
- `getAvailableStock(productId)` — stock minus pending/confirmed reservations
- `getProductsWithAvailableStock()` — for catalog API (batch query)

## 2.3 Stock Reservations (`src/lib/db/reservations.ts`)

```typescript
export const reservationsTable = defineTable<Reservation, ReservationInput>({
  name: "stock_reservations",
  primaryKey: "id",
  schema: {
    id: col.generated<number>(),
    product_id: col.simple<number>(),
    quantity: col.simple<number>(),
    stripe_session_id: col.simple<string>(),
    status: col.withDefault(() => "pending"),
    created: col.withDefault(() => new Date().toISOString()),
  },
});
```

Operations needed:
- `reserveStock(productId, quantity, stripeSessionId)` — atomic reserve with
  availability check:
  ```sql
  INSERT INTO stock_reservations (product_id, quantity, stripe_session_id, status, created)
  SELECT ?, ?, ?, 'pending', ?
  WHERE (
    SELECT stock FROM products WHERE id = ? AND active = 1
  ) - COALESCE((
    SELECT SUM(quantity) FROM stock_reservations
    WHERE product_id = ? AND status IN ('pending', 'confirmed')
  ), 0) >= ?
  ```
  Returns success/failure. This is the same atomic pattern as
  `createAttendeeAtomic` from the tickets app.
- `confirmReservation(stripeSessionId)` — UPDATE status to `confirmed`
- `expireReservation(stripeSessionId)` — UPDATE status to `expired`
- `expireStaleReservations(maxAgeMs)` — expire old `pending` reservations
- `restockFromRefund(stripeSessionId)` — set confirmed reservations to `expired`
  (returns stock to pool)

## 2.4 Settings Table (`src/lib/db/settings.ts`)

Simplified version — no encryption, just key-value:
- `getSetting(key)` / `setSetting(key, value)`
- Used for: `admin_password_hash`, `setup_complete`, `notification_webhook_url`

## 2.5 Config (`src/lib/config.ts`)

Read all config from environment variables:
```typescript
export const getAllowedOrigins = (): string[] =>
  (process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);

export const getStripeSecretKey = (): string =>
  process.env.STRIPE_SECRET_KEY ?? "";

export const getStripeWebhookSecret = (): string =>
  process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const getCurrency = (): string =>
  process.env.CURRENCY ?? "GBP";
```

## 2.6 Auth (`src/lib/auth.ts`)

Single-admin auth reusing the sessions table pattern, but simplified:
- No multi-user, no invite codes, no wrapped data keys
- Password hashing with PBKDF2 (reuse the algorithm from crypto.ts, just the
  hashing parts — no encryption)
- Session tokens: random string, hashed for DB storage, set as cookie
- CSRF tokens on forms

Sessions table:
```sql
CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    expires INTEGER NOT NULL
);
```

## 2.7 Entry Point (`src/index.ts`)

Simplify:
```typescript
import { initDb } from "#lib/db/migrations/index.ts";
import { handleRequest } from "#routes/index.ts";

await initDb();
Deno.serve({ port: Number(process.env.PORT ?? 3000) }, handleRequest);
```

No encryption key validation needed.

## 2.8 Tests

Write tests for:
- `products.ts` — CRUD, `getAvailableStock`, active filtering
- `reservations.ts` — reserve/confirm/expire/restock, atomic availability check,
  stale reservation cleanup
- `settings.ts` — get/set
- `config.ts` — env var parsing, defaults
- `auth.ts` — password hashing, session creation/validation/expiry
- `migrations/index.ts` — schema creation, idempotent re-runs

Test utils to add:
- `createTestDb()` — in-memory SQLite with new schema
- `resetDb()` — clear all tables
- `createTestProduct(overrides?)` — insert a product with sensible defaults
- `createTestSession()` — authenticated admin session

Commit: "Add product catalog, stock reservations, and admin auth"

---

# Step 3: Support API Calls

Build the HTTP layer: public product API, checkout, webhooks, admin pages.

## 3.1 CORS Middleware (`src/routes/middleware.ts`)

Replace domain validation with CORS:

```typescript
export const corsHeaders = (origin: string | null): Record<string, string> => {
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
  }
  return {};
};
```

Handle OPTIONS preflight requests in the main router.

Keep security headers (CSP, X-Frame-Options, etc.) for admin pages.

## 3.2 Public API Routes (`src/routes/api.ts`)

### `GET /api/products`

Returns JSON array of active products with available stock:

```json
[
  {
    "sku": "WIDGET-01",
    "name": "Blue Widget",
    "description": "A nice widget",
    "unit_price": 1500,
    "price_formatted": "15.00",
    "currency": "GBP",
    "stock": 23,
    "in_stock": true,
    "image_url": "/images/widget.jpg"
  }
]
```

- Fetches all active products
- Computes available stock (total - pending/confirmed reservations)
- `stock: -1` means unlimited → `in_stock: true`, `stock` omitted from response
- Products with `stock: 0` available are included but with `in_stock: false`

### `POST /api/checkout`

Request:
```json
{
  "items": [
    { "sku": "WIDGET-01", "quantity": 2 },
    { "sku": "GADGET-03", "quantity": 1 }
  ],
  "success_url": "https://myshop.com/order-complete/",
  "cancel_url": "https://myshop.com/cart/"
}
```

Flow:
1. Validate origin header against `ALLOWED_ORIGINS`
2. Validate items array (non-empty, valid structure)
3. Fetch products by SKU, validate all exist and are active
4. For each item, atomically reserve stock (using `reserveStock`)
5. If any reservation fails, release all previous reservations and return error
6. Create Stripe Checkout session with line items from DB prices
   (not from request — backend is source of truth)
7. Store the `stripe_session_id` in all reservations
8. Return `{ url: session.url }` (redirect URL for Stripe Checkout)

Response (success):
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_..." }
```

Response (out of stock):
```json
{ "error": "Insufficient stock", "details": [{ "sku": "WIDGET-01", "available": 1, "requested": 2 }] }
```

### Checkout validation differences from old version

The old version fetches SKU prices from the static site's JSON. We don't do
that — the backend is the source of truth. The static site fetches from us.
This eliminates the whole `getSkuPrices` / `skuPricesCache` mechanism and the
associated trust problem.

## 3.3 Stripe Module (`src/lib/stripe.ts`)

Thin wrapper around the Stripe SDK:

```typescript
export const createCheckoutSession = (params: {
  lineItems: Array<{ name: string; unitAmount: number; quantity: number }>;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}) => { ... };

export const retrieveSession = (sessionId: string) => { ... };
export const verifyWebhookSignature = (payload: string, signature: string) => { ... };
```

Metadata stored on the session:
```json
{ "reservation_ids": "1,2,3" }
```

This lets the webhook handler know which reservations to confirm/expire
without querying by session ID (though we can also query by session ID as
a fallback).

## 3.4 Webhook Route (`src/routes/webhook.ts`)

### `POST /api/webhook/stripe`

Handles three event types:

**`checkout.session.completed`**:
1. Verify signature
2. Extract session ID
3. Update all `stock_reservations` with that session ID from `pending` → `confirmed`
4. (Optional) POST to notification webhook URL if configured in settings
5. Return 200

**`checkout.session.expired`**:
1. Verify signature
2. Extract session ID
3. Update all `stock_reservations` with that session ID from `pending` → `expired`
4. Return 200

**`charge.refunded`**:
1. Verify signature
2. Extract payment intent → look up checkout session → get session ID
3. Update `stock_reservations` from `confirmed` → `expired` (restocks)
4. Return 200

All handlers are idempotent — updating an already-confirmed or already-expired
reservation is a no-op.

## 3.5 Admin Routes (`src/routes/admin/`)

Minimal admin panel with HTML pages (reuse JSX template pattern from tickets app).

### Dashboard (`GET /admin`)
- List all products with: name, SKU, price, stock, available stock, active status
- "Add Product" button
- Each product has Edit / Delete links

### Product Form (`GET /admin/product/:id/edit`, `POST /admin/product/:id`)
- Fields: name, SKU, description, unit_price (displayed as decimal, stored as int),
  stock (-1 for unlimited), active checkbox, image_url
- SKU uniqueness validation

### Create Product (`POST /admin/product/new`)
- Same form as edit, submitted to different endpoint

### Delete Product (`POST /admin/product/:id/delete`)
- Confirmation required
- Cascading delete of stock_reservations for that product

### Orders (`GET /admin/orders`)
- Calls `stripe.checkout.sessions.list({ limit: 25 })` and displays results
- Shows: date, customer email, amount, payment status
- Link to Stripe dashboard for each order
- Pagination via Stripe cursor

### Order Detail (`GET /admin/orders/:sessionId`)
- Calls `stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] })`
- Shows line items, customer details, payment status
- Link to Stripe dashboard

### Auth (`POST /admin/login`, `GET /admin/logout`)
- Session cookie + CSRF token
- Single admin user

### Settings (`POST /admin/settings/password`)
- Change admin password

## 3.6 Setup Route (`src/routes/setup.ts`)

First-run setup:
1. Check if `setup_complete` setting exists
2. If not, show form to set admin password
3. On submit, hash password, store in settings, set `setup_complete`

## 3.7 Main Router (`src/routes/index.ts`)

```typescript
export const handleRequest = async (request: Request): Promise<Response> => {
  // OPTIONS preflight
  if (request.method === "OPTIONS") return handleCorsPreflightResponse(request);

  // Health check (no auth, no CORS)
  if (path === "/health") return handleHealthCheck();

  // Setup (if not complete)
  if (!isSetupComplete()) return routeSetup(request);

  // Public API (CORS-enabled, JSON)
  if (path.startsWith("/api/")) return withCors(routeApi(request));

  // Admin (session auth, HTML)
  if (path.startsWith("/admin")) return routeAdmin(request);

  return new Response("Not Found", { status: 404 });
};
```

## 3.8 Tests

Write tests for every route:

**API tests:**
- `GET /api/products` — returns active products with stock, excludes inactive
- `POST /api/checkout` — validates origin, validates cart, reserves stock,
  returns Stripe URL; rejects invalid origin, empty cart, unknown SKU,
  insufficient stock
- Stock reservation atomicity — concurrent checkouts for last item
- CORS headers present on API responses

**Webhook tests:**
- Signature verification (reject invalid signatures)
- `checkout.session.completed` — confirms reservations
- `checkout.session.expired` — expires reservations
- `charge.refunded` — restocks
- Idempotency — processing same event twice is safe
- Unknown event types acknowledged without error

**Admin tests:**
- Unauthenticated requests redirect to login
- Product CRUD operations
- Orders page fetches from Stripe API
- Password change
- CSRF validation

**Setup tests:**
- First-run shows setup page
- After setup, normal routes work
- Setup page not accessible after completion

**Integration tests:**
- Full flow: create product → checkout → webhook → stock confirmed
- Full flow: create product → checkout → session expires → stock released
- Full flow: checkout → pay → refund → stock restored

Commit: "Add public API, Stripe checkout, webhooks, and admin"

---

## Summary of Changes

| Aspect | Tickets App | Ecommerce Backend |
|--------|-------------|-------------------|
| Database tables | 8 | 4 (products, stock_reservations, settings, sessions) |
| Encryption | AES-256 + hybrid PII encryption | None (no PII stored) |
| Payment providers | Stripe + Square | Stripe only |
| Customer data | Stored encrypted in attendees | Stored in Stripe only |
| Order data | Stored in attendees + processed_payments | Stored in Stripe only |
| Admin users | Multi-user with invites | Single admin |
| Public UI | HTML ticket forms | JSON API (static site is the UI) |
| CORS | Not needed (same-origin forms) | Required (cross-origin API) |
| Stock/capacity | `max_attendees` with atomic check | `stock` with reservation system |
| Webhooks | Confirm attendee creation | Confirm/expire stock reservations |

## File Structure (Final)

```
src/
├── index.ts                      # Entry point
├── fp/index.ts                   # FP utilities (unchanged)
├── edge/bunny-script.ts          # Edge runtime compat (unchanged)
├── lib/
│   ├── config.ts                 # Env var config
│   ├── auth.ts                   # Password hashing + session management
│   ├── stripe.ts                 # Stripe SDK wrapper
│   ├── db/
│   │   ├── client.ts             # libsql wrapper (unchanged)
│   │   ├── table.ts              # Table abstraction (unchanged)
│   │   ├── migrations/index.ts   # Schema: products, stock_reservations, settings, sessions
│   │   ├── products.ts           # Product CRUD + stock queries
│   │   ├── reservations.ts       # Stock reservation operations
│   │   ├── settings.ts           # Key-value settings
│   │   └── sessions.ts           # Admin sessions
│   └── jsx/
│       ├── jsx-runtime.ts        # JSX runtime (for admin templates)
│       └── jsx-dev-runtime.ts
├── routes/
│   ├── index.ts                  # Main router
│   ├── router.ts                 # Pattern matching router (unchanged)
│   ├── middleware.ts             # CORS + security headers
│   ├── health.ts                 # Health check
│   ├── setup.ts                  # First-run setup
│   ├── api.ts                    # Public API: products + checkout
│   ├── webhook.ts                # Stripe webhooks
│   └── admin/
│       ├── index.ts              # Admin router
│       ├── auth.ts               # Login/logout
│       ├── dashboard.ts          # Product list
│       ├── products.ts           # Product CRUD
│       ├── orders.ts             # Orders (proxied from Stripe)
│       └── settings.ts           # Password change
├── templates/
│   ├── layout.tsx                # Base HTML layout
│   └── admin/
│       ├── login.tsx
│       ├── dashboard.tsx
│       ├── products.tsx
│       ├── orders.tsx
│       └── settings.tsx
└── test-utils/
    ├── test-compat.ts            # Jest-like API (unchanged)
    ├── index.ts                  # Test helpers
    └── stripe-mock.ts            # Stripe API mock

test/
├── setup.ts
└── lib/
    ├── fp.test.ts
    ├── config.test.ts
    ├── auth.test.ts
    ├── products.test.ts
    ├── reservations.test.ts
    ├── settings.test.ts
    ├── stripe.test.ts
    ├── api-products.test.ts
    ├── api-checkout.test.ts
    ├── webhook.test.ts
    ├── admin-auth.test.ts
    ├── admin-products.test.ts
    ├── admin-orders.test.ts
    ├── setup.test.ts
    └── middleware.test.ts
```
