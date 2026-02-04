/**
 * Admin product management routes
 * All admin users (owner + manager) can manage products
 */

import { getProductsWithAvailableStock, productsTable } from "#lib/db/products.ts";
import { getDb } from "#lib/db/client.ts";
import { validateForm } from "#lib/forms.tsx";
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
import { productFields } from "#templates/fields.ts";

/** Parse product ID from path like /admin/product/123/edit */
const parseProductId = (path: string): number | null => {
  const match = path.match(/^\/admin\/product\/(\d+)/);
  return match ? Number(match[1]) : null;
};

/** Get a product by ID or return null */
const getProductById = async (id: number): Promise<Product | null> => {
  const result = await getDb().execute({
    sql: "SELECT * FROM products WHERE id = ?",
    args: [id],
  });
  return result.rows.length > 0 ? (result.rows[0] as unknown as Product) : null;
};

/**
 * GET /admin/ — product list (dashboard) or login page
 */
const handleDashboard = (request: Request): Promise<Response> =>
  withSession(
    request,
    async (session) => {
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
  withAuthForm(request, async (session, form) => {
    const validation = validateForm(form, productFields);
    if (!validation.valid) {
      return htmlResponse(adminProductFormPage(session, {}, validation.error), 400);
    }

    const { values } = validation;
    await productsTable.insert({
      name: values.name as string,
      sku: values.sku as string,
      description: (values.description as string) ?? "",
      unitPrice: values.unit_price as number,
      stock: values.stock as number,
      active: Number(values.active ?? 1),
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

    const product = await getProductById(productId);
    if (!product) return htmlResponse("Not found", 404);

    return htmlResponse(adminProductFormPage(session, {
      name: product.name,
      sku: product.sku,
      description: product.description,
      unit_price: product.unit_price,
      stock: product.stock,
      active: String(product.active),
    }, undefined, productId));
  });

/**
 * POST /admin/product/:id — update product
 */
const handleUpdateProduct = (request: Request, path: string): Promise<Response> =>
  withAuthForm(request, async (session, form) => {
    const productId = parseProductId(path);
    if (!productId) return htmlResponse("Not found", 404);

    const product = await getProductById(productId);
    if (!product) return htmlResponse("Not found", 404);

    const validation = validateForm(form, productFields);
    if (!validation.valid) {
      return htmlResponse(
        adminProductFormPage(session, {}, validation.error, productId),
        400,
      );
    }

    const { values } = validation;
    await getDb().execute({
      sql: `UPDATE products SET name = ?, sku = ?, description = ?, unit_price = ?, stock = ?, active = ? WHERE id = ?`,
      args: [
        values.name as string,
        values.sku as string,
        (values.description as string) ?? "",
        values.unit_price as number,
        values.stock as number,
        Number(values.active ?? 1),
        productId,
      ] as (string | number)[],
    });

    return redirect("/admin/");
  });

/**
 * POST /admin/product/:id/delete — delete product
 */
const handleDeleteProduct = (request: Request, path: string): Promise<Response> =>
  withAuthForm(request, async (_session, _form) => {
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
