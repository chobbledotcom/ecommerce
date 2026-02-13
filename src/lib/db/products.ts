/**
 * Products table operations
 */

import { inPlaceholders, queryOne, queryRows } from "#lib/db/client.ts";
import { col, defineTable } from "#lib/db/table.ts";
import type { Product } from "#lib/types.ts";

/** Input type for creating a product (camelCase keys for table insert) */
export type ProductInput = {
  sku: string;
  name: string;
  description?: string;
  unitPrice: number;
  stock?: number;
  active?: number;
  created?: string;
};

export const productsTable = defineTable<Product, ProductInput>({
  name: "products",
  primaryKey: "id",
  schema: {
    id: col.generated<number>(),
    sku: col.simple<string>(),
    name: col.simple<string>(),
    description: col.withDefault(() => ""),
    unit_price: col.simple<number>(),
    stock: col.withDefault(() => 0),
    active: col.withDefault(() => 1),
    created: col.timestamp(),
  },
});

/** Get all active products ordered by name */
export const getAllActiveProducts = (): Promise<Product[]> =>
  queryRows<Product>("SELECT * FROM products WHERE active = 1 ORDER BY name");

/** Get all products ordered by created DESC (for admin) */
export const getAllProducts = (): Promise<Product[]> =>
  queryRows<Product>("SELECT * FROM products ORDER BY created DESC");

/** Get a product by SKU */
export const getProductBySku = (sku: string): Promise<Product | null> =>
  queryOne<Product>("SELECT * FROM products WHERE sku = ?", [sku]);

/** Get multiple products by SKUs */
export const getProductsBySkus = (
  skus: string[],
): Promise<Product[]> => {
  if (skus.length === 0) return Promise.resolve([]);
  return queryRows<Product>(
    `SELECT * FROM products WHERE sku IN (${inPlaceholders(skus)})`,
    skus,
  );
};

/** Get available stock for a product (stock minus pending/confirmed reservations) */
export const getAvailableStock = async (
  productId: number,
): Promise<number> => {
  const product = await productsTable.findById(productId);
  if (!product) return 0;
  if (product.stock === -1) return -1; // unlimited

  // Aggregate with COALESCE always returns a row
  const reserved = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM stock_reservations
     WHERE product_id = ? AND status IN ('pending', 'confirmed')`,
    [productId],
  );

  return Math.max(0, product.stock - reserved!.total);
};

/** Get total sold/reserved quantity for a product (pending + confirmed reservations) */
export const getSoldCount = async (productId: number): Promise<number> => {
  // Aggregate with COALESCE always returns a row
  const result = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM stock_reservations
     WHERE product_id = ? AND status IN ('pending', 'confirmed')`,
    [productId],
  );
  return result!.total;
};

/** Product with computed available stock */
export type ProductWithStock = Product & { available_stock: number };

/** Get all active products with available stock computed */
export const getProductsWithAvailableStock = (): Promise<
  ProductWithStock[]
> =>
  queryRows<ProductWithStock>(`
    SELECT p.*,
      CASE
        WHEN p.stock = -1 THEN -1
        ELSE MAX(0, p.stock - COALESCE(
          (SELECT SUM(sr.quantity)
           FROM stock_reservations sr
           WHERE sr.product_id = p.id AND sr.status IN ('pending', 'confirmed')),
          0
        ))
      END as available_stock
    FROM products p
    WHERE p.active = 1
    ORDER BY p.name
  `);
