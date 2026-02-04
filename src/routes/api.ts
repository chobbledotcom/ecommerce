/**
 * Public API routes — product catalog and checkout
 *
 * These endpoints are called from the static storefront site.
 * CORS headers are applied by the main router for allowed origins.
 */

import { map } from "#fp";
import { getCurrencyCode } from "#lib/config.ts";
import { getProductsBySkus, getProductsWithAvailableStock } from "#lib/db/products.ts";
import { expireReservation, reserveStock } from "#lib/db/reservations.ts";
import { ErrorCode, logError } from "#lib/logger.ts";
import { getActivePaymentProvider } from "#lib/payments.ts";
import type { Product } from "#lib/types.ts";
import { createRouter, defineRoutes } from "#routes/router.ts";

/** Get provider or return a 503 error response */
const requireProvider = async () => {
  const p = await getActivePaymentProvider();
  return p ?? null;
};

/** JSON response helper */
const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Format price from smallest unit to decimal string */
const formatPrice = (unitPrice: number): string =>
  (unitPrice / 100).toFixed(2);

/** Map a product + available stock to the public API shape */
const toApiProduct = (currency: string) => (p: Product & { available_stock: number }) => ({
  sku: p.sku,
  name: p.name,
  description: p.description,
  unit_price: p.unit_price,
  price_formatted: formatPrice(p.unit_price),
  currency,
  ...(p.available_stock === -1
    ? { in_stock: true }
    : { stock: p.available_stock, in_stock: p.available_stock > 0 }),
});

/**
 * GET /api/products — active products with available stock
 */
const handleGetProducts = async (): Promise<Response> => {
  const [products, currency] = await Promise.all([
    getProductsWithAvailableStock(),
    getCurrencyCode(),
  ]);
  return jsonResponse(map(toApiProduct(currency))(products));
};

/** Cart item from the checkout request */
type CartItem = { sku: string; quantity: number };

/** Validate checkout request body */
const parseCheckoutBody = (body: unknown): CartItem[] | null => {
  if (!body || typeof body !== "object") return null;
  const { items } = body as { items?: unknown };
  if (!Array.isArray(items) || items.length === 0) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const { sku, quantity } = item as { sku?: unknown; quantity?: unknown };
    if (typeof sku !== "string" || !sku) return null;
    if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity)) return null;
  }
  return items as CartItem[];
};

/** Parse and validate success/cancel URLs */
const parseUrls = (body: unknown): { successUrl: string; cancelUrl: string } | null => {
  if (!body || typeof body !== "object") return null;
  const { success_url, cancel_url } = body as { success_url?: unknown; cancel_url?: unknown };
  if (typeof success_url !== "string" || typeof cancel_url !== "string") return null;
  return { successUrl: success_url, cancelUrl: cancel_url };
};

/**
 * POST /api/checkout — validate cart, reserve stock, create provider session
 */
const handlePostCheckout = async (request: Request): Promise<Response> => {
  const provider = await requireProvider();
  if (!provider) return jsonResponse({ error: "Payments not configured" }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const items = parseCheckoutBody(body);
  if (!items) {
    return jsonResponse({ error: "Invalid items array" }, 400);
  }

  const urls = parseUrls(body);
  if (!urls) {
    return jsonResponse({ error: "Missing success_url or cancel_url" }, 400);
  }

  // Fetch products by SKU (backend is source of truth for prices)
  const skus = map((i: CartItem) => i.sku)(items);
  const products = await getProductsBySkus(skus);
  const productBySku = new Map(map((p: Product) => [p.sku, p] as const)(products));

  // Validate all SKUs exist and are active
  for (const item of items) {
    const product = productBySku.get(item.sku);
    if (!product || !product.active) {
      return jsonResponse({ error: `Product not found: ${item.sku}` }, 400);
    }
  }

  // Reserve stock for each item (use a temp session ID, update after provider session creation)
  const tempSessionId = crypto.randomUUID();
  const reservationIds: number[] = [];

  for (const item of items) {
    const product = productBySku.get(item.sku)!;
    const reservationId = await reserveStock(product.id, item.quantity, tempSessionId);
    if (!reservationId) {
      // Insufficient stock — release all previous reservations
      if (reservationIds.length > 0) {
        await expireReservation(tempSessionId);
      }
      return jsonResponse({
        error: "Insufficient stock",
        details: [{ sku: item.sku, requested: item.quantity }],
      }, 409);
    }
    reservationIds.push(reservationId);
  }

  // Create provider checkout session
  const currency = await getCurrencyCode();
  const result = await provider.createCheckoutSession({
    lineItems: map((item: CartItem) => {
      const product = productBySku.get(item.sku)!;
      return {
        name: product.name,
        unitPrice: product.unit_price,
        quantity: item.quantity,
      };
    })(items),
    metadata: { reservation_ids: reservationIds.join(",") },
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    currency: currency.toLowerCase(),
  });

  if (!result) {
    // Provider failed — release reservations
    await expireReservation(tempSessionId);
    logError({ code: ErrorCode.PAYMENT_CHECKOUT, detail: "provider returned null" });
    return jsonResponse({ error: "Failed to create checkout session" }, 502);
  }

  // Update reservations with the real provider session ID
  const { getDb } = await import("#lib/db/client.ts");
  await getDb().execute({
    sql: "UPDATE stock_reservations SET provider_session_id = ? WHERE provider_session_id = ?",
    args: [result.sessionId, tempSessionId],
  });

  return jsonResponse({ url: result.checkoutUrl });
};

/** Public API route definitions */
const apiRoutes = defineRoutes({
  "GET /api/products": () => handleGetProducts(),
  "POST /api/checkout": (request) => handlePostCheckout(request),
});

/** Route public API requests */
export const routeApi = createRouter(apiRoutes);
