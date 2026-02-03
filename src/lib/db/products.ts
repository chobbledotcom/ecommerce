/**
 * Products table operations
 */

import { getDb, inPlaceholders, queryOne } from "#lib/db/client.ts";
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
export const getAllActiveProducts = async (): Promise<Product[]> => {
  const result = await getDb().execute(
    "SELECT * FROM products WHERE active = 1 ORDER BY name",
  );
  return result.rows as unknown as Product[];
};

/** Get all products ordered by created DESC (for admin) */
export const getAllProducts = async (): Promise<Product[]> => {
  const result = await getDb().execute(
    "SELECT * FROM products ORDER BY created DESC",
  );
  return result.rows as unknown as Product[];
};

/** Get a product by SKU */
export const getProductBySku = (sku: string): Promise<Product | null> =>
  queryOne<Product>("SELECT * FROM products WHERE sku = ?", [sku]);

/** Get multiple products by SKUs */
export const getProductsBySkus = async (
  skus: string[],
): Promise<Product[]> => {
  if (skus.length === 0) return [];
  const result = await getDb().execute({
    sql: `SELECT * FROM products WHERE sku IN (${inPlaceholders(skus)})`,
    args: skus,
  });
  return result.rows as unknown as Product[];
};

/** Get available stock for a product (stock minus pending/confirmed reservations) */
export const getAvailableStock = async (
  productId: number,
): Promise<number> => {
  const product = await productsTable.findById(productId);
  if (!product) return 0;
  if (product.stock === -1) return -1; // unlimited

  const reserved = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM stock_reservations
     WHERE product_id = ? AND status IN ('pending', 'confirmed')`,
    [productId],
  );

  return Math.max(0, product.stock - (reserved?.total ?? 0));
};

/** Product with computed available stock */
export type ProductWithStock = Product & { available_stock: number };

/** Get all active products with available stock computed */
export const getProductsWithAvailableStock = async (): Promise<
  ProductWithStock[]
> => {
  const result = await getDb().execute(`
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
  return result.rows as unknown as ProductWithStock[];
};
