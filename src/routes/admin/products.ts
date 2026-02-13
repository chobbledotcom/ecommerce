/**
 * Admin product management routes
 * All admin users (owner + manager) can manage products
 */

import { getProductsWithAvailableStock, getSoldCount, productsTable } from "#lib/db/products.ts";
import { getDb, queryOne } from "#lib/db/client.ts";
import { expireStaleReservations } from "#lib/db/reservations.ts";
import type { Product } from "#lib/types.ts";
import { defineRoutes } from "#routes/router.ts";
import { loginResponse } from "#routes/admin/dashboard.ts";
import {
  htmlResponse,
  redirect,
  requireSessionOr,
  withAuthForm,
  withSession,
} from "#routes/utils.ts";
import { adminProductFormPage, adminProductListPage } from "#templates/admin/products.tsx";
import { parseProductForm } from "#templates/fields.ts";

/** Parse product ID from path like /admin/product/123/edit.
 *  Only called from routes already matched by /admin/product/\d+. */
const parseProductId = (path: string): number =>
  Number(path.match(/^\/admin\/product\/(\d+)/)?.[1]);

/** Get a product by ID or return null */
const getProductById = (id: number): Promise<Product | null> =>
  queryOne<Product>("SELECT * FROM products WHERE id = ?", [id]);

/** 30 minutes — matches the stale threshold used in checkout */
const STALE_RESERVATION_MS = 30 * 60 * 1000;

/**
 * GET /admin/ — product list (dashboard) or login page
 */
const handleDashboard = (request: Request): Promise<Response> =>
  withSession(
    request,
    async (session) => {
      await expireStaleReservations(STALE_RESERVATION_MS);
      const products = await getProductsWithAvailableStock();
      return htmlResponse(adminProductListPage(products, session));
    },
    () => loginResponse(),
  );

/**
 * GET /admin/product/new — new product form
 */
const handleNewProductGet = (request: Request): Promise<Response> =>
  requireSessionOr(request, (session) =>
    htmlResponse(adminProductFormPage(session)));

/**
 * POST /admin/product/new — create product
 */
const handleNewProductPost = (request: Request): Promise<Response> =>
  withAuthForm(request, async ({ session, form }) => {
    const validation = parseProductForm(form);
    if (!validation.valid) {
      return htmlResponse(adminProductFormPage(session, {}, validation.error), 400);
    }

    await productsTable.insert({
      name: validation.name,
      sku: validation.sku,
      description: validation.description,
      unitPrice: validation.unitPrice,
      stock: validation.stock,
      active: validation.active,
    });

    return redirect("/admin/");
  });

/**
 * GET /admin/product/:id/edit — edit product form
 */
const handleEditProductGet = (request: Request, path: string): Promise<Response> =>
  requireSessionOr(request, async (session) => {
    const productId = parseProductId(path);
    if (!productId) return htmlResponse("Not found", 404);

    await expireStaleReservations(STALE_RESERVATION_MS);
    const product = await getProductById(productId);
    if (!product) return htmlResponse("Not found", 404);

    const sold = product.stock === -1 ? 0 : await getSoldCount(productId);
    const remaining = product.stock === -1 ? -1 : product.stock - sold;

    return htmlResponse(adminProductFormPage(session, {
      name: product.name,
      sku: product.sku,
      description: product.description,
      unit_price: product.unit_price,
      stock: remaining,
      active: String(product.active),
    }, undefined, productId, sold));
  });

/**
 * POST /admin/product/:id — update product
 */
const handleUpdateProduct = (request: Request, path: string): Promise<Response> =>
  withAuthForm(request, async ({ session, form }) => {
    const productId = parseProductId(path);
    if (!productId) return htmlResponse("Not found", 404);

    const product = await getProductById(productId);
    if (!product) return htmlResponse("Not found", 404);

    const sold = product.stock === -1 ? 0 : await getSoldCount(productId);

    const validation = parseProductForm(form);
    if (!validation.valid) {
      return htmlResponse(
        adminProductFormPage(session, {}, validation.error, productId, sold),
        400,
      );
    }

    const actualStock = validation.stock === -1
      ? -1
      : validation.stock + sold;

    await getDb().execute({
      sql: `UPDATE products SET name = ?, sku = ?, description = ?, unit_price = ?, stock = ?, active = ? WHERE id = ?`,
      args: [
        validation.name,
        validation.sku,
        validation.description,
        validation.unitPrice,
        actualStock,
        validation.active,
        productId,
      ],
    });

    return redirect("/admin/");
  });

/**
 * POST /admin/product/:id/delete — delete product
 */
const handleDeleteProduct = (request: Request, path: string): Promise<Response> =>
  withAuthForm(request, async () => {
    const productId = parseProductId(path);
    if (!productId) return htmlResponse("Not found", 404);

    // Delete reservations first (foreign key constraint)
    await getDb().execute({
      sql: "DELETE FROM stock_reservations WHERE product_id = ?",
      args: [productId],
    });
    await getDb().execute({
      sql: "DELETE FROM products WHERE id = ?",
      args: [productId],
    });

    return redirect("/admin/");
  });

/** Product management routes */
export const productRoutes = defineRoutes({
  "GET /admin": (request) => handleDashboard(request),
  "GET /admin/product/new": (request) => handleNewProductGet(request),
  "POST /admin/product/new": (request) => handleNewProductPost(request),
});

/** Dynamic product routes (need path for ID extraction) */
export const routeProductDynamic = (
  request: Request,
  path: string,
  method: string,
): Promise<Response | null> | null => {
  if (method === "GET" && path.match(/^\/admin\/product\/\d+\/edit$/)) {
    return handleEditProductGet(request, path);
  }
  if (method === "POST" && path.match(/^\/admin\/product\/\d+\/delete$/)) {
    return handleDeleteProduct(request, path);
  }
  if (method === "POST" && path.match(/^\/admin\/product\/\d+$/)) {
    return handleUpdateProduct(request, path);
  }
  return null;
};
