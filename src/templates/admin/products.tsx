/**
 * Admin product management templates
 */

import { renderFields } from "#lib/forms.tsx";
import { Raw } from "#lib/jsx/jsx-runtime.ts";
import type { AdminSession } from "#lib/types.ts";
import type { ProductWithStock } from "#lib/db/products.ts";
import { Layout } from "#templates/layout.tsx";
import { AdminNav, Breadcrumb } from "#templates/admin/nav.tsx";
import { productFields } from "#templates/fields.ts";
import type { Field, FieldValues } from "#lib/forms.tsx";
import { map } from "#fp";

/** Format price from smallest unit to decimal */
const formatPrice = (unitPrice: number): string =>
  (unitPrice / 100).toFixed(2);

/** Stock display text */
const stockText = ({ stock, available_stock }: ProductWithStock): string =>
  stock === -1 ? "Unlimited" : `${available_stock} / ${stock}`;

/**
 * Product list (dashboard) page
 */
export const adminProductListPage = (
  products: ProductWithStock[],
  session: AdminSession,
): string =>
  String(
    <Layout title="Products">
      <AdminNav session={session} />
      <header>
        <h1>Products</h1>
        <a href="/admin/product/new" role="button">Add Product</a>
      </header>
      {products.length === 0
        ? <p>No products yet. Add your first product to get started.</p>
        : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr>
                  <td>{p.name}</td>
                  <td><code>{p.sku}</code></td>
                  <td>{formatPrice(p.unit_price)}</td>
                  <td>{stockText(p)}</td>
                  <td>{p.active ? "Active" : "Inactive"}</td>
                  <td><a href={`/admin/product/${p.id}/edit`}>Edit</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Layout>
  );

/**
 * Product create/edit form page
 */
/** Build product fields with a dynamic stock label showing sold count */
const stockLabelFields = (soldCount?: number): Field[] =>
  soldCount !== undefined
    ? map((f: Field): Field =>
      f.name === "stock"
        ? { ...f, labelHtml: `Stock <small>(${soldCount} sold)</small>` }
        : f
    )(productFields)
    : productFields;

export const adminProductFormPage = (
  session: AdminSession,
  values: FieldValues = {},
  error?: string,
  productId?: number,
  soldCount?: number,
): string => {
  const isEdit = productId !== undefined;
  const title = isEdit ? "Edit Product" : "New Product";
  const action = isEdit ? `/admin/product/${productId}` : "/admin/product/new";
  const fields = stockLabelFields(soldCount);

  return String(
    <Layout title={title}>
      <AdminNav session={session} />
      <Breadcrumb href="/admin/" label="Products" />
      <h1>{title}</h1>
      {error && <div class="error">{error}</div>}
      <form method="POST" action={action}>
        <input type="hidden" name="csrf_token" value={session.csrfToken} />
        <Raw html={renderFields(fields, values)} />
        <button type="submit">{isEdit ? "Update Product" : "Create Product"}</button>
      </form>
      {isEdit && (
        <form method="POST" action={`/admin/product/${productId}/delete`}>
          <input type="hidden" name="csrf_token" value={session.csrfToken} />
          <button type="submit" class="danger">Delete Product</button>
        </form>
      )}
    </Layout>
  );
};
