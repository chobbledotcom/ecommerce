/**
 * Public API routes — product catalog and checkout
 *
 * These endpoints are called from the static storefront site.
 * CORS headers are applied by the main router for allowed origins.
 */

import { map } from "#fp";
import { getCurrencyCode } from "#lib/config.ts";
import { isCheckoutRateLimited, recordCheckoutAttempt } from "#lib/db/checkout-attempts.ts";
import { getProductsBySkus, getProductsWithAvailableStock } from "#lib/db/products.ts";
import { expireReservation, type ReservationItem, reserveStockBatch, updateReservationSessionId } from "#lib/db/reservations.ts";
import { ErrorCode, logError } from "#lib/logger.ts";
import { getActivePaymentProvider } from "#lib/payments.ts";
import type { Product } from "#lib/types.ts";
import { createRouter, defineRoutes } from "#routes/router.ts";
import type { ServerContext } from "#routes/types.ts";
import { getClientIp } from "#routes/utils.ts";

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

/** Typed checkout request — what the JSON body produces after parsing */
type CheckoutRequest = {
  items: CartItem[];
  successUrl: string;
  cancelUrl: string;
};

/** Parse and validate the full checkout request body, returning typed data or error string */
const parseCheckoutRequest = (body: unknown): CheckoutRequest | string => {
  if (!body || typeof body !== "object") return "Invalid items array";
  const { items, success_url, cancel_url } = body as Record<string, unknown>;

  if (!Array.isArray(items) || items.length === 0) return "Invalid items array";
  const parsed: CartItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return "Invalid items array";
    const { sku, quantity } = item as Record<string, unknown>;
    if (typeof sku !== "string" || !sku) return "Invalid items array";
    if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity))
      return "Invalid items array";
    parsed.push({ sku, quantity });
  }

  if (typeof success_url !== "string" || typeof cancel_url !== "string")
    return "Missing success_url or cancel_url";

  return { items: parsed, successUrl: success_url, cancelUrl: cancel_url };
};

/**
 * POST /api/checkout — validate cart, reserve stock, create provider session
 */
const handlePostCheckout = async (request: Request, server?: ServerContext): Promise<Response> => {
  // Rate limit by client IP to prevent stock reservation abuse
  const clientIp = getClientIp(request, server);
  if (await isCheckoutRateLimited(clientIp)) {
    return jsonResponse({ error: "Too many checkout attempts. Please try again later." }, 429);
  }
  await recordCheckoutAttempt(clientIp);

  const provider = await requireProvider();
  if (!provider) return jsonResponse({ error: "Payments not configured" }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const checkout = parseCheckoutRequest(body);
  if (typeof checkout === "string") {
    return jsonResponse({ error: checkout }, 400);
  }

  const { items, successUrl, cancelUrl } = checkout;

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

  // Reserve stock for all items in a single transaction (expires stale reservations first)
  const tempSessionId = crypto.randomUUID();
  const reservationItems: ReservationItem[] = map((item: CartItem) => {
    const product = productBySku.get(item.sku)!;
    return { productId: product.id, quantity: item.quantity };
  })(items);
  const skuByProductId = new Map(map((p: Product) => [p.id, p.sku] as const)(products));

  const reservation = await reserveStockBatch(reservationItems, skuByProductId, tempSessionId);
  if (!reservation.ok) {
    const failedItem = items.find((i) => i.sku === reservation.failedSku);
    return jsonResponse({
      error: "Insufficient stock",
      details: [{ sku: reservation.failedSku, requested: failedItem?.quantity ?? 0 }],
    }, 409);
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
    metadata: { reservation_ids: reservation.reservationIds.join(",") },
    successUrl,
    cancelUrl,
    currency: currency.toLowerCase(),
  });

  if (!result) {
    // Provider failed — release reservations
    await expireReservation(tempSessionId);
    logError({ code: ErrorCode.PAYMENT_CHECKOUT, detail: "provider returned null" });
    return jsonResponse({ error: "Failed to create checkout session" }, 502);
  }

  // Update reservations with the real provider session ID
  await updateReservationSessionId(tempSessionId, result.sessionId);

  return jsonResponse({ url: result.checkoutUrl });
};

/** Public API route definitions */
const apiRoutes = defineRoutes({
  "GET /api/products": () => handleGetProducts(),
  "POST /api/checkout": (request, _params, server) => handlePostCheckout(request, server),
});

/** Route public API requests */
export const routeApi = createRouter(apiRoutes);
