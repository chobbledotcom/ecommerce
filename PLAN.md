# Implementation Plan: Ecommerce Backend

Replace the ticket reservation system with an ecommerce checkout backend.
The backend is the source of truth for product catalog and stock levels, connects
to a static site for the storefront, and delegates all order/customer data
storage to the configured payment provider (Stripe or Square).

## Design Principles

- **Backend owns products and stock** — the static site fetches catalog from the API
- **Payment provider owns orders and customers** — we store only the provider's
  session/order ID in our stock reservations table, and query the provider's API
  for order details
- **No customer PII in our database** — no customer names, emails, or addresses
  stored locally; admin usernames and API keys are encrypted at rest (existing model)
- **Keep existing encryption model** — the user/session/settings encryption
  infrastructure from the tickets app is retained as-is (`DB_ENCRYPTION_KEY`,
  KEK/data-key hierarchy, encrypted settings)
- **Keep existing multi-user auth** — owner and manager roles with invite flow;
  managers cannot access settings or user management
- **Keep payment provider abstraction** — Stripe and Square via the existing
  `PaymentProvider` interface, configured through the admin settings page
- **All config via admin settings page** — payment keys, allowed origins, currency,
  and other settings are stored encrypted in the database, not in environment
  variables (except `DB_URL`, `DB_TOKEN`, `DB_ENCRYPTION_KEY`, `ALLOWED_DOMAIN`)
- **Stateless checkout flow** — reserve stock → create provider session → confirm on
  webhook → release on expiry/cancel

## Architecture Overview

```
Static Site (your domain)
    │
    ├── GET  /api/products          ← fetch catalog + stock at build time & page load
    ├── POST /api/checkout          ← submit cart, get payment provider Checkout URL
    │
    └── Payment Provider Checkout (hosted by Stripe/Square)
            │
            ├── success → redirect to static site /order-complete/
            └── webhook → POST /payment/webhook
                              │
                              ├── checkout completed → confirm reservation
                              ├── checkout expired   → release reservation
                              └── refunded           → restock
```

## Database Schema

New tables for ecommerce. The existing tables (users, sessions, settings,
login_attempts, activity_log) are retained as-is from the tickets app.

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
    created TEXT NOT NULL
);

-- Stock reservations (tracks in-flight checkout sessions)
CREATE TABLE stock_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    provider_session_id TEXT NOT NULL,     -- Stripe session ID or Square order ID
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | expired
    created TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_reservations_session ON stock_reservations(provider_session_id);
CREATE INDEX idx_reservations_status ON stock_reservations(status, created);
```

### Stock Reservation Flow

1. `POST /api/checkout` — for each cart item, atomically:
   ```sql
   -- Check available stock (total - pending/confirmed reservations)
   -- If sufficient, INSERT into stock_reservations with status='pending'
   ```
2. Checkout completed webhook → UPDATE reservation status to `confirmed`
3. Checkout expired webhook → UPDATE reservation status to `expired`
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
| `POST` | `/api/checkout` | Validate cart, reserve stock, create provider checkout session |
| `GET` | `/health` | Status + configured providers |

### Webhook (provider signature verified)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/payment/webhook` | Handle checkout completed/expired, refunds (Stripe or Square) |

### Admin (session auth, HTML UI)

All admin routes require authentication. Routes marked **(owner)** are restricted
to owner role only; managers cannot access them.

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| `GET` | `/admin` | all | Dashboard — product list with stock levels |
| `POST` | `/admin/login` | public | Authenticate |
| `GET` | `/admin/logout` | all | Clear session |
| `POST` | `/admin/product/new` | all | Create product |
| `GET` | `/admin/product/:id/edit` | all | Edit form |
| `POST` | `/admin/product/:id` | all | Update product (name, SKU, price, stock, etc.) |
| `POST` | `/admin/product/:id/delete` | all | Delete product |
| `GET` | `/admin/orders` | all | List recent orders (fetched from payment provider API) |
| `GET` | `/admin/orders/:sessionId` | all | Order detail (fetched from payment provider API) |
| `GET` | `/admin/users` | owner | List users |
| `POST` | `/admin/users` | owner | Invite new user (owner or manager) |
| `POST` | `/admin/users/:id/delete` | owner | Delete user |
| `GET` | `/admin/settings` | owner | Settings page |
| `POST` | `/admin/settings/password` | owner | Change password |
| `POST` | `/admin/settings/payment-provider` | owner | Select Stripe/Square/none |
| `POST` | `/admin/settings/stripe` | owner | Configure Stripe keys |
| `POST` | `/admin/settings/square` | owner | Configure Square keys |
| `POST` | `/admin/settings/allowed-origins` | owner | Configure CORS allowed origins |
| `POST` | `/admin/settings/currency` | owner | Set currency code |
| `GET` | `/admin/sessions` | all | View own active sessions |
| `POST` | `/admin/sessions/delete-others` | all | Logout other sessions |

### Setup (existing flow, unchanged)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/setup` | Initial setup form (owner user, currency, encryption keys) |
| `POST` | `/setup` | Create owner user + initialise encryption key hierarchy |

## Environment Variables (Bunny Native Secrets)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DB_URL` | Yes | libsql database URL |
| `DB_TOKEN` | For remote DB | Database auth token |
| `DB_ENCRYPTION_KEY` | Yes | 32-byte base64-encoded encryption key |
| `ALLOWED_DOMAIN` | Yes | Domain for webhook URL construction and security validation |
| `PORT` | No | Server port (default: `3000`, local dev only) |

All other configuration (payment provider keys, allowed origins, currency) is
stored encrypted in the database and managed through the admin settings page.
This is the same model as the tickets app.

### Settings (stored in DB, managed via admin UI)

| Setting | Purpose |
|---------|---------|
| `PAYMENT_PROVIDER` | `"stripe"`, `"square"`, or `"none"` |
| `STRIPE_SECRET_KEY` | Stripe API secret key (encrypted) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (encrypted) |
| `SQUARE_ACCESS_TOKEN` | Square access token (encrypted) |
| `SQUARE_LOCATION_ID` | Square location ID (encrypted) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square webhook signature key (encrypted) |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins for CORS |
| `CURRENCY_CODE` | ISO 4217 code (default: `GBP`) |
| `SETUP_COMPLETE` | Boolean flag |

---

# Step 1: Delete Ticket-Specific Code ✅

Remove only the code that is purely about events, attendees, tickets, check-in,
and QR codes. Keep all reusable infrastructure intact.

## Kept (all reusable infrastructure)

| Category | Files | Reason |
|----------|-------|--------|
| FP utilities | `src/fp/index.ts` | Used throughout |
| Database | `src/lib/db/client.ts`, `table.ts`, `migrations/`, `sessions.ts`, `users.ts`, `settings.ts`, `login-attempts.ts`, `activityLog.ts`, `processed-payments.ts` | Auth, sessions, settings, logging all reused |
| Encryption | `src/lib/crypto.ts`, `payment-crypto.ts` | Encryption model retained |
| Payments | `src/lib/payments.ts`, `payment-helpers.ts`, `stripe.ts`, `stripe-provider.ts`, `square.ts`, `square-provider.ts` | Provider abstraction + both providers retained |
| Auth/config | `src/lib/config.ts`, `env.ts`, `logger.ts`, `types.ts`, `forms.tsx`, `webhook.ts` | Reusable utilities |
| REST | `src/lib/rest/` | Resource abstraction |
| JSX | `src/lib/jsx/` | Admin page rendering |
| Routes | `src/routes/` (router, index, middleware, health, setup, webhooks, static, assets, admin/*) | Admin framework, auth, settings, sessions, users all reused |
| Templates | `src/templates/` (layout, setup, admin/login, admin/dashboard, admin/nav, admin/sessions, admin/settings, admin/users, fields) | Admin UI templates |
| Static | `src/static/` | CSS and favicon |
| Test infra | `src/test-utils/`, `src/types/`, `src/edge/` | Test compat, type declarations, edge runtime |
| Entry point | `src/index.ts` | Server entry |

## Deleted (ticket-specific only)

| Path | What it was |
|------|-------------|
| `src/lib/db/attendees.ts` | Attendee data model |
| `src/lib/db/events.ts` | Events data model |
| `src/lib/qr.ts` | QR code generation for tickets |
| `src/lib/slug.ts` | Slug generation for event URLs |
| `src/config/asset-paths.ts` | Ticket asset path config |
| `src/routes/checkin.ts` | Check-in routes |
| `src/routes/join.ts` | Invite acceptance flow |
| `src/routes/tickets.ts` | Ticket display |
| `src/routes/token-utils.ts` | Ticket token utilities |
| `src/routes/public.ts` | Ticket registration pages |
| `src/routes/admin/attendees.ts` | Admin attendee management |
| `src/routes/admin/events.ts` | Admin event management |
| `src/templates/checkin.tsx` | Check-in template |
| `src/templates/join.tsx` | Join/invite template |
| `src/templates/tickets.tsx` | Ticket display template |
| `src/templates/public.tsx` | Public registration template |
| `src/templates/payment.tsx` | Payment form template |
| `src/templates/csv.ts` | CSV export for attendees |
| `test/lib/slug.test.ts` | Slug tests |
| `test/lib/qr.test.ts` | QR tests |
| `test/lib/server-attendees.test.ts` | Attendee route tests |
| `test/lib/server-events.test.ts` | Event route tests |
| `test/lib/server-checkin.test.ts` | Check-in route tests |
| `test/lib/server-tickets.test.ts` | Ticket route tests |
| `test/lib/server-public.test.ts` | Public route tests |

## deno.json changes

- Removed `qrcode` dependency
- All other imports and dependencies retained

---

# Step 2: Add Products and Stock Reservations

Add the product catalog and stock reservation system. The existing auth,
encryption, sessions, users, settings, and payment provider infrastructure
stays unchanged — we're adding new tables alongside them.

## 2.1 Database Migrations (`src/lib/db/migrations/index.ts`)

Add migrations for the new tables (do not replace existing migrations):
- `products` table (see schema above)
- `stock_reservations` table

Existing tables (users, sessions, settings, login_attempts, activity_log,
processed_payments) remain. Keep the same migration pattern (idempotent
`runMigration`, version tracking via `latest_db_update` setting).

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
    provider_session_id: col.simple<string>(),
    status: col.withDefault(() => "pending"),
    created: col.withDefault(() => new Date().toISOString()),
  },
});
```

Operations needed:
- `reserveStock(productId, quantity, providerSessionId)` — atomic reserve with
  availability check:
  ```sql
  INSERT INTO stock_reservations (product_id, quantity, provider_session_id, status, created)
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
- `confirmReservation(providerSessionId)` — UPDATE status to `confirmed`
- `expireReservation(providerSessionId)` — UPDATE status to `expired`
- `expireStaleReservations(maxAgeMs)` — expire old `pending` reservations
- `restockFromRefund(providerSessionId)` — set confirmed reservations to `expired`
  (returns stock to pool)

## 2.4 Existing Infrastructure (unchanged)

These modules are **not modified** in this step:
- `src/lib/db/settings.ts` — existing encrypted key-value settings (used for
  payment provider config, currency, allowed origins, etc.)
- `src/lib/db/users.ts` — multi-user with owner/manager roles
- `src/lib/db/sessions.ts` — session management with data key wrapping
- `src/lib/db/login-attempts.ts` — login rate limiting
- `src/lib/db/activityLog.ts` — activity logging
- `src/lib/db/processed-payments.ts` — payment idempotency
- `src/lib/config.ts` — config reading from env + DB settings
- `src/lib/crypto.ts` — encryption/hashing
- `src/lib/payments.ts` — payment provider abstraction
- `src/lib/stripe.ts`, `src/lib/stripe-provider.ts` — Stripe integration
- `src/lib/square.ts`, `src/lib/square-provider.ts` — Square integration
- `src/index.ts` — entry point (existing encryption key validation stays)

## 2.5 Config additions (`src/lib/config.ts`)

Add a function to read allowed origins from the DB settings (not env vars):

```typescript
export const getAllowedOrigins = async (): Promise<string[]> =>
  // Read ALLOWED_ORIGINS from encrypted settings table
  // Returns comma-separated origins, split and trimmed
```

This works alongside the existing `getPaymentProvider()`, `getCurrencyCode()`,
etc. that already read from DB settings.

## 2.6 Extend Payment Provider interface

Add a `listSessions` method to the `PaymentProvider` interface for order
viewing in admin:

```typescript
// Add to PaymentProvider interface:
listSessions(params: { limit: number; startingAfter?: string }):
  Promise<{ sessions: PaymentSession[]; hasMore: boolean }>;
```

Implement for Stripe (using `checkout.sessions.list`) and Square (using
Orders API `searchOrders`). Square's implementation is new — the existing
code only has `retrieveOrder` by ID.

## 2.7 Tests

Write tests for new code only:
- `products.ts` — CRUD, `getAvailableStock`, active filtering
- `reservations.ts` — reserve/confirm/expire/restock, atomic availability check,
  stale reservation cleanup
- `config.ts` — `getAllowedOrigins` from DB settings
- `migrations/index.ts` — new table creation alongside existing tables

Existing tests for auth, sessions, users, settings, payments etc. should
continue to pass unchanged.

Test utils to add:
- `createTestProduct(overrides?)` — insert a product with sensible defaults

Commit: "Add product catalog and stock reservations"

---

# Step 3: Support API Calls

Build the HTTP layer: public product API, checkout, webhooks, and admin
product/order management. The existing admin auth, settings, users, and
sessions routes are reused — we're adding new routes alongside them.

## 3.1 CORS Middleware (`src/routes/middleware.ts`)

Add CORS support alongside the existing domain validation and security headers.
Allowed origins are read from the DB settings table (configured via admin UI).

```typescript
export const corsHeaders = async (origin: string | null): Promise<Record<string, string>> => {
  const allowed = await getAllowedOrigins(); // from DB settings
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

Keep existing security headers (CSP, X-Frame-Options, etc.) for admin pages.

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
1. Validate origin header against `ALLOWED_ORIGINS` (from DB settings)
2. Validate items array (non-empty, valid structure)
3. Fetch products by SKU, validate all exist and are active
4. For each item, atomically reserve stock (using `reserveStock`)
5. If any reservation fails, release all previous reservations and return error
6. Use the configured payment provider (via `PaymentProvider` interface) to
   create a checkout session with line items from DB prices
   (not from request — backend is source of truth)
7. Store the provider's session/order ID in all reservations
8. Return `{ url: session.url }` (redirect URL for provider checkout)

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

## 3.3 Payment Provider Integration

The existing `PaymentProvider` interface and provider implementations
(`stripe-provider.ts`, `square-provider.ts`) are reused. The checkout flow
uses `createCheckoutSession` / `createMultiCheckoutSession` from the active
provider.

The existing `src/lib/stripe.ts` and `src/lib/square.ts` modules handle the
low-level SDK calls. These are extended (not rewritten) to support:
- **Stripe**: `checkout.sessions.list` for order listing
- **Square**: `searchOrders` for order listing (new)

Metadata stored on the provider session:
```json
{ "reservation_ids": "1,2,3" }
```

## 3.4 Webhook Route (`src/routes/webhooks.ts`)

Extend the existing webhook handler to handle stock reservation confirmation
alongside the existing payment processing flow.

### `POST /payment/webhook` (existing route)

The existing webhook route already handles signature verification and provider
dispatch. Add stock reservation handling to the completion/expiry/refund flows:

**On checkout completed** (existing event):
1. Existing: verify signature, process payment
2. New: update `stock_reservations` with that session ID from `pending` → `confirmed`

**On checkout expired** (new handler):
1. Verify signature
2. Update `stock_reservations` from `pending` → `expired`

**On refund** (extend existing handler):
1. Existing: verify signature
2. New: update `stock_reservations` from `confirmed` → `expired` (restocks)

All handlers are idempotent — updating an already-confirmed or already-expired
reservation is a no-op.

## 3.5 Admin Routes

### Existing admin routes (unchanged)

These admin routes from the tickets app are reused as-is:
- `src/routes/admin/auth.ts` — login/logout with multi-user support
- `src/routes/admin/users.ts` — user management (owner only)
- `src/routes/admin/settings.ts` — payment provider config, password change (owner only)
- `src/routes/admin/sessions.ts` — session management
- `src/routes/admin/utils.ts` — admin middleware helpers
- `src/routes/admin/index.ts` — admin route aggregator (update to include new routes)

### New admin routes

#### `src/routes/admin/products.ts` (new)

**Dashboard (`GET /admin`)** — modify existing dashboard:
- Replace event list with product list
- Show: name, SKU, price (formatted), stock, available stock, active status
- "Add Product" button
- Each product has Edit / Delete links

**Product Form (`GET /admin/product/:id/edit`, `POST /admin/product/:id`)**:
- Fields: name, SKU, description, unit_price (displayed as decimal, stored as int),
  stock (-1 for unlimited), active checkbox, image_url
- SKU uniqueness validation
- Both owner and manager can manage products

**Create Product (`POST /admin/product/new`)**:
- Same form as edit, submitted to different endpoint

**Delete Product (`POST /admin/product/:id/delete`)**:
- Confirmation required
- Cascading delete of stock_reservations for that product

#### `src/routes/admin/orders.ts` (new)

**Orders (`GET /admin/orders`)**:
- Uses the active payment provider's `listSessions` method
- Shows: date, customer email, amount, payment status
- Link to provider dashboard for each order
- Pagination via provider cursor
- Works with both Stripe and Square

**Order Detail (`GET /admin/orders/:sessionId`)**:
- Uses the active provider's `retrieveSession` method
- Shows line items, customer details, payment status
- Link to provider dashboard

### Settings additions

Add to the existing settings page (owner only):
- **Allowed Origins** (`POST /admin/settings/allowed-origins`):
  comma-separated origins for CORS
- **Currency** (`POST /admin/settings/currency`):
  if not already configurable (check existing settings page)

The existing settings page already handles payment provider selection
(Stripe/Square), Stripe key configuration, Square key configuration,
and password changes.

## 3.6 Admin Templates

### Existing templates (unchanged or minor updates)
- `src/templates/layout.tsx` — base HTML layout
- `src/templates/admin/login.tsx` — login form
- `src/templates/admin/nav.tsx` — navigation (update to add Products/Orders links)
- `src/templates/admin/sessions.tsx` — session list
- `src/templates/admin/settings.tsx` — settings form (add allowed origins field)
- `src/templates/admin/users.tsx` — user management
- `src/templates/setup.tsx` — setup form

### New templates
- `src/templates/admin/dashboard.tsx` — rewrite to show products instead of events
- `src/templates/admin/products.tsx` — product create/edit form
- `src/templates/admin/orders.tsx` — order list and detail views

## 3.7 Setup Route (`src/routes/setup.ts`)

Existing setup flow, unchanged. Creates owner user, generates encryption key
hierarchy, sets currency code, marks setup complete.

## 3.8 Main Router (`src/routes/index.ts`)

Update the existing router to add the public API routes and CORS handling:

```typescript
// Add to existing route handling:

// OPTIONS preflight for CORS
if (request.method === "OPTIONS") return handleCorsPreflightResponse(request);

// Public API (CORS-enabled, JSON) — NEW
if (path.startsWith("/api/")) return withCors(routeApi(request));

// Existing routes continue to work:
// /health, /setup, /admin/*, /payment/webhook, etc.
```

## 3.9 Tests

Write tests for new routes:

**API tests:**
- `GET /api/products` — returns active products with stock, excludes inactive
- `POST /api/checkout` — validates origin, validates cart, reserves stock,
  returns provider checkout URL; rejects invalid origin, empty cart, unknown SKU,
  insufficient stock
- Stock reservation atomicity — concurrent checkouts for last item
- CORS headers present on API responses

**Webhook tests:**
- Stock reservation confirmation on checkout completed
- Stock release on checkout expired
- Restock on refund
- Idempotency — processing same event twice is safe

**Admin product tests:**
- Product CRUD operations (both owner and manager)
- SKU uniqueness validation
- Available stock calculation

**Admin order tests:**
- Orders page fetches from provider API (test with both Stripe and Square mocks)
- Order detail retrieval
- Pagination

**Integration tests:**
- Full flow: create product → checkout → webhook → stock confirmed
- Full flow: create product → checkout → session expires → stock released
- Full flow: checkout → pay → refund → stock restored

Existing tests for auth, users, settings, sessions should continue to pass.

Commit: "Add public API, checkout, webhooks, and admin product/order management"

---

## Summary of Changes

| Aspect | Tickets App | Ecommerce Backend |
|--------|-------------|-------------------|
| Domain model | Events + attendees + tickets | Products + stock reservations |
| Database tables | 8 | Same 6 existing + 2 new (products, stock_reservations) |
| Encryption | AES-256 + hybrid encryption | Same (unchanged) |
| Payment providers | Stripe + Square | Same (unchanged) |
| Customer data | Stored encrypted in attendees | Stored in provider only (no local PII) |
| Order data | Stored in attendees + processed_payments | Queried from provider API |
| Admin users | Multi-user with owner/manager roles | Same (unchanged) |
| Public UI | HTML ticket forms | JSON API (static site is the UI) |
| CORS | Not needed (same-origin forms) | Required (cross-origin API) |
| Stock/capacity | `max_attendees` with atomic check | `stock` with reservation system |
| Webhooks | Confirm attendee creation | Confirm/expire stock reservations |
| Config | Env vars + DB settings | Same model (DB settings via admin UI) |

## What Changed vs What Stayed

**Removed** (ticket-specific):
- Events, attendees, tickets, check-in, QR codes, slugs, CSV export
- Public ticket registration/display pages and templates
- ~7,500 lines of ticket-specific code and tests

**Added** (ecommerce):
- Products table + CRUD
- Stock reservations table + atomic reserve/confirm/expire
- Public JSON API (`/api/products`, `/api/checkout`)
- CORS middleware for cross-origin static site
- Admin product management pages
- Admin order viewing (via provider API)
- Allowed origins setting in admin UI
- `listSessions`/`searchOrders` on payment providers

**Unchanged** (reusable infrastructure):
- Multi-user auth (owner/manager roles, invite flow)
- Encryption model (KEK, data keys, encrypted settings)
- Session management (with data key wrapping)
- Payment provider abstraction (Stripe + Square)
- Login rate limiting
- Activity logging
- Admin framework (auth, users, settings, sessions routes + templates)
- Setup flow
- JSX templates, static assets, router, health check
- FP utilities, DB client/table abstraction
- Test infrastructure

## File Structure (Final)

Files marked (**new**) are created. Files marked (**modified**) have changes.
All other files are retained unchanged from the tickets app.

```
src/
├── index.ts                      # Entry point (unchanged)
├── fp/index.ts                   # FP utilities (unchanged)
├── edge/bunny-script.ts          # Edge runtime compat (unchanged)
├── lib/
│   ├── config.ts                 # Config (modified — add getAllowedOrigins)
│   ├── crypto.ts                 # Encryption/hashing (unchanged)
│   ├── payment-crypto.ts         # Payment crypto (unchanged)
│   ├── payments.ts               # Provider interface (modified — add listSessions)
│   ├── payment-helpers.ts        # Payment helpers (unchanged)
│   ├── stripe.ts                 # Stripe SDK (modified — add sessions.list)
│   ├── stripe-provider.ts        # Stripe provider (modified — add listSessions)
│   ├── square.ts                 # Square SDK (modified — add searchOrders)
│   ├── square-provider.ts        # Square provider (modified — add listSessions)
│   ├── env.ts                    # Environment helpers (unchanged)
│   ├── logger.ts                 # Logger (unchanged)
│   ├── types.ts                  # Types (modified — add product/reservation types)
│   ├── forms.tsx                 # Form validation (unchanged)
│   ├── webhook.ts                # Webhook forwarding (unchanged)
│   ├── db/
│   │   ├── client.ts             # libsql wrapper (unchanged)
│   │   ├── table.ts              # Table abstraction (unchanged)
│   │   ├── migrations/index.ts   # Migrations (modified — add products + reservations tables)
│   │   ├── products.ts           # Product CRUD + stock queries (new)
│   │   ├── reservations.ts       # Stock reservation operations (new)
│   │   ├── settings.ts           # Encrypted settings (unchanged)
│   │   ├── sessions.ts           # Session management (unchanged)
│   │   ├── users.ts              # User management (unchanged)
│   │   ├── login-attempts.ts     # Rate limiting (unchanged)
│   │   ├── activityLog.ts        # Activity logging (unchanged)
│   │   └── processed-payments.ts # Payment idempotency (unchanged)
│   ├── rest/
│   │   ├── handlers.ts           # REST handlers (unchanged)
│   │   └── resource.ts           # REST resource (unchanged)
│   └── jsx/
│       ├── jsx-runtime.ts        # JSX runtime (unchanged)
│       └── jsx-dev-runtime.ts
├── routes/
│   ├── index.ts                  # Main router (modified — add /api/* + CORS)
│   ├── router.ts                 # Pattern matching router (unchanged)
│   ├── middleware.ts             # Middleware (modified — add CORS headers)
│   ├── health.ts                 # Health check (unchanged)
│   ├── setup.ts                  # Setup flow (unchanged)
│   ├── static.ts                 # Static file serving (unchanged)
│   ├── assets.ts                 # Asset handling (unchanged)
│   ├── webhooks.ts               # Webhooks (modified — add reservation handling)
│   ├── api.ts                    # Public API: products + checkout (new)
│   ├── utils.ts                  # Route utilities (unchanged)
│   ├── types.ts                  # Route types (unchanged)
│   └── admin/
│       ├── index.ts              # Admin router (modified — add product/order routes)
│       ├── auth.ts               # Login/logout (unchanged)
│       ├── dashboard.ts          # Dashboard (modified — products instead of events)
│       ├── products.ts           # Product CRUD (new)
│       ├── orders.ts             # Orders from provider API (new)
│       ├── users.ts              # User management (unchanged)
│       ├── settings.ts           # Settings (modified — add allowed origins)
│       ├── sessions.ts           # Session management (unchanged)
│       └── utils.ts              # Admin utilities (unchanged)
├── templates/
│   ├── layout.tsx                # Base HTML layout (unchanged)
│   ├── setup.tsx                 # Setup form (unchanged)
│   ├── fields.ts                 # Form field helpers (unchanged)
│   └── admin/
│       ├── login.tsx             # Login form (unchanged)
│       ├── nav.tsx               # Navigation (modified — add Products/Orders links)
│       ├── dashboard.tsx         # Dashboard (modified — show products)
│       ├── products.tsx          # Product form (new)
│       ├── orders.tsx            # Order list/detail (new)
│       ├── sessions.tsx          # Session list (unchanged)
│       ├── settings.tsx          # Settings form (modified — add allowed origins)
│       └── users.tsx             # User management (unchanged)
├── static/
│   ├── favicon.svg               # Favicon (unchanged)
│   └── mvp.css                   # Stylesheet (unchanged)
├── test-utils/
│   ├── test-compat.ts            # Jest-like API (unchanged)
│   ├── index.ts                  # Test helpers (modified — add product helpers)
│   └── stripe-mock.ts            # Stripe mock (modified — add sessions.list mock)
└── types/
    └── static.d.ts               # Type declarations (unchanged)

test/
├── setup.ts                      # Test setup (unchanged)
└── lib/
    ├── fp.test.ts                # (unchanged)
    ├── config.test.ts            # (unchanged + new tests for getAllowedOrigins)
    ├── crypto.test.ts            # (unchanged)
    ├── env.test.ts               # (unchanged)
    ├── forms.test.ts             # (unchanged)
    ├── logger.test.ts            # (unchanged)
    ├── db.test.ts                # (unchanged)
    ├── jsx-runtime.test.ts       # (unchanged)
    ├── rest.test.ts              # (unchanged)
    ├── webhook.test.ts           # (unchanged)
    ├── payment-crypto.test.ts    # (unchanged)
    ├── payment-helpers.test.ts   # (unchanged)
    ├── processed-payments.test.ts # (unchanged)
    ├── stripe.test.ts            # (unchanged + new tests for list)
    ├── stripe-mock.test.ts       # (unchanged)
    ├── square.test.ts            # (unchanged + new tests for search)
    ├── square-provider.test.ts   # (unchanged + new tests for listSessions)
    ├── html.test.ts              # (unchanged)
    ├── test-utils.test.ts        # (unchanged)
    ├── build-edge.test.ts        # (unchanged)
    ├── code-quality.test.ts      # (unchanged)
    ├── server-auth.test.ts       # (unchanged)
    ├── server-users.test.ts      # (unchanged)
    ├── server-settings.test.ts   # (unchanged)
    ├── server-setup.test.ts      # (unchanged)
    ├── server-payments.test.ts   # (unchanged)
    ├── server-webhooks.test.ts   # (unchanged + new reservation tests)
    ├── server-misc.test.ts       # (unchanged)
    ├── products.test.ts          # Product CRUD + stock (new)
    ├── reservations.test.ts      # Reserve/confirm/expire (new)
    ├── api-products.test.ts      # GET /api/products (new)
    ├── api-checkout.test.ts      # POST /api/checkout (new)
    ├── admin-products.test.ts    # Admin product CRUD (new)
    ├── admin-orders.test.ts      # Admin order viewing (new)
    └── middleware.test.ts        # CORS tests (new)
```
