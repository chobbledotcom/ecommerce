import { afterEach, beforeEach, describe, expect, test } from "#test-compat";
import {
  getAllActiveProducts,
  getAllProducts,
  getAvailableStock,
  getProductBySku,
  getProductsBySkus,
  getProductsWithAvailableStock,
  productsTable,
} from "#lib/db/products.ts";
import { reserveStock } from "#lib/db/reservations.ts";
import { createTestDb, createTestProduct, resetDb } from "#test-utils";

describe("products", () => {
  beforeEach(async () => {
    await createTestDb();
  });

  afterEach(() => {
    resetDb();
  });

  describe("productsTable.insert", () => {
    test("creates a product with required fields", async () => {
      const product = await createTestProduct({
        sku: "WIDGET-01",
        name: "Blue Widget",
        unitPrice: 1500,
      });

      expect(product.id).toBe(1);
      expect(product.sku).toBe("WIDGET-01");
      expect(product.name).toBe("Blue Widget");
      expect(product.unit_price).toBe(1500);
      expect(product.stock).toBe(0);
      expect(product.active).toBe(1);
      expect(product.description).toBe("");
      expect(product.image_url).toBe("");
      expect(product.created).toBeDefined();
    });

    test("creates a product with all fields", async () => {
      const product = await createTestProduct({
        sku: "GADGET-01",
        name: "Red Gadget",
        description: "A very red gadget",
        unitPrice: 2500,
        stock: 50,
        active: 0,
        imageUrl: "/images/gadget.jpg",
      });

      expect(product.description).toBe("A very red gadget");
      expect(product.stock).toBe(50);
      expect(product.active).toBe(0);
      expect(product.image_url).toBe("/images/gadget.jpg");
    });

    test("enforces unique SKU constraint", async () => {
      await createTestProduct({ sku: "DUPE-SKU" });
      await expect(createTestProduct({ sku: "DUPE-SKU" })).rejects.toThrow();
    });
  });

  describe("productsTable.findById", () => {
    test("returns product by ID", async () => {
      const created = await createTestProduct({ sku: "FIND-ME" });
      const found = await productsTable.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.sku).toBe("FIND-ME");
    });

    test("returns null for non-existent ID", async () => {
      const found = await productsTable.findById(999);
      expect(found).toBeNull();
    });
  });

  describe("productsTable.update", () => {
    test("updates product fields", async () => {
      const product = await createTestProduct({ sku: "UPD-01", unitPrice: 1000 });
      const updated = await productsTable.update(product.id, {
        name: "Updated Name",
        unitPrice: 2000,
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.unit_price).toBe(2000);
    });

    test("returns null for non-existent ID", async () => {
      const result = await productsTable.update(999, { name: "Nope" });
      expect(result).toBeNull();
    });
  });

  describe("productsTable.deleteById", () => {
    test("deletes a product", async () => {
      const product = await createTestProduct();
      await productsTable.deleteById(product.id);
      const found = await productsTable.findById(product.id);
      expect(found).toBeNull();
    });
  });

  describe("getAllActiveProducts", () => {
    test("returns only active products ordered by name", async () => {
      await createTestProduct({ sku: "B-PROD", name: "Beta", active: 1 });
      await createTestProduct({ sku: "A-PROD", name: "Alpha", active: 1 });
      await createTestProduct({ sku: "C-PROD", name: "Charlie", active: 0 });

      const active = await getAllActiveProducts();

      expect(active).toHaveLength(2);
      expect(active[0]!.name).toBe("Alpha");
      expect(active[1]!.name).toBe("Beta");
    });

    test("returns empty array when no active products", async () => {
      await createTestProduct({ active: 0 });
      const active = await getAllActiveProducts();
      expect(active).toHaveLength(0);
    });
  });

  describe("getAllProducts", () => {
    test("returns all products ordered by created DESC", async () => {
      await createTestProduct({
        sku: "FIRST",
        name: "First",
        created: "2024-01-01T00:00:00.000Z",
      });
      await createTestProduct({
        sku: "SECOND",
        name: "Second",
        created: "2024-01-02T00:00:00.000Z",
      });

      const products = await getAllProducts();

      expect(products).toHaveLength(2);
      // Most recently created first
      expect(products[0]!.name).toBe("Second");
      expect(products[1]!.name).toBe("First");
    });
  });

  describe("getProductBySku", () => {
    test("finds product by SKU", async () => {
      await createTestProduct({ sku: "UNIQUE-SKU", name: "Found Me" });

      const product = await getProductBySku("UNIQUE-SKU");
      expect(product).not.toBeNull();
      expect(product!.name).toBe("Found Me");
    });

    test("returns null for unknown SKU", async () => {
      const product = await getProductBySku("NONEXISTENT");
      expect(product).toBeNull();
    });
  });

  describe("getProductsBySkus", () => {
    test("returns products matching given SKUs", async () => {
      await createTestProduct({ sku: "SKU-A" });
      await createTestProduct({ sku: "SKU-B" });
      await createTestProduct({ sku: "SKU-C" });

      const products = await getProductsBySkus(["SKU-A", "SKU-C"]);
      expect(products).toHaveLength(2);
      const skus = products.map((p) => p.sku).sort();
      expect(skus).toEqual(["SKU-A", "SKU-C"]);
    });

    test("returns empty array for empty input", async () => {
      const products = await getProductsBySkus([]);
      expect(products).toHaveLength(0);
    });

    test("ignores unknown SKUs", async () => {
      await createTestProduct({ sku: "REAL" });
      const products = await getProductsBySkus(["REAL", "FAKE"]);
      expect(products).toHaveLength(1);
    });
  });

  describe("getAvailableStock", () => {
    test("returns full stock when no reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      const available = await getAvailableStock(product.id);
      expect(available).toBe(10);
    });

    test("subtracts pending reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 3, "session-1");

      const available = await getAvailableStock(product.id);
      expect(available).toBe(7);
    });

    test("returns -1 for unlimited stock", async () => {
      const product = await createTestProduct({ stock: -1 });
      await reserveStock(product.id, 5, "session-1");

      const available = await getAvailableStock(product.id);
      expect(available).toBe(-1);
    });

    test("returns 0 for non-existent product", async () => {
      const available = await getAvailableStock(999);
      expect(available).toBe(0);
    });

    test("does not count expired reservations", async () => {
      const product = await createTestProduct({ stock: 10 });
      await reserveStock(product.id, 5, "session-1");
      // Manually expire the reservation
      const { getDb } = await import("#lib/db/client.ts");
      await getDb().execute({
        sql: "UPDATE stock_reservations SET status = 'expired' WHERE provider_session_id = ?",
        args: ["session-1"],
      });

      const available = await getAvailableStock(product.id);
      expect(available).toBe(10);
    });
  });

  describe("getProductsWithAvailableStock", () => {
    test("returns active products with computed available stock", async () => {
      const product = await createTestProduct({ sku: "STOCK-A", stock: 20, active: 1 });
      await reserveStock(product.id, 5, "session-1");

      const products = await getProductsWithAvailableStock();
      expect(products).toHaveLength(1);
      expect(products[0]!.available_stock).toBe(15);
    });

    test("returns -1 available_stock for unlimited stock products", async () => {
      await createTestProduct({ sku: "UNLIMITED", stock: -1, active: 1 });

      const products = await getProductsWithAvailableStock();
      expect(products).toHaveLength(1);
      expect(products[0]!.available_stock).toBe(-1);
    });

    test("excludes inactive products", async () => {
      await createTestProduct({ active: 0 });

      const products = await getProductsWithAvailableStock();
      expect(products).toHaveLength(0);
    });
  });
});
