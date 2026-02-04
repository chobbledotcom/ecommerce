/**
 * Admin order detail template
 */

import type { AdminSession, PaymentSessionDetail, Reservation } from "#lib/types.ts";
import { Layout } from "#templates/layout.tsx";
import { AdminNav, Breadcrumb } from "#templates/admin/nav.tsx";

/** Format amount from smallest unit */
const formatAmount = (amount: number | null, currency: string | null): string => {
  if (amount === null) return "-";
  const formatted = (amount / 100).toFixed(2);
  return currency ? `${formatted} ${currency.toUpperCase()}` : formatted;
};

/** Format date from ISO string */
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "-";
  return `${new Date(dateStr).toLocaleDateString()} ${new Date(dateStr).toLocaleTimeString()}`;
};

/** Reservation status labels */
const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  expired: "Expired / Refunded",
};

/** Provider display names */
const PROVIDER_NAMES: Record<string, string> = { stripe: "Stripe", square: "Square" };

/**
 * Admin order detail page
 */
export const adminOrderDetailPage = (
  detail: PaymentSessionDetail,
  reservations: Reservation[],
  session: AdminSession,
  error?: string,
  success?: string,
): string =>
  String(
    <Layout title="Order Detail">
      <AdminNav session={session} />
      <Breadcrumb href="/admin/orders" label="Orders" />
      <h1>Order Detail</h1>

      {error && <p><mark>{error}</mark></p>}
      {success && <p><small>{success}</small></p>}

      <section>
        <table>
          <tbody>
            <tr><th>Session ID</th><td><code>{detail.id}</code></td></tr>
            <tr><th>Provider</th><td>{PROVIDER_NAMES[detail.providerType]}</td></tr>
            <tr><th>Status</th><td>{detail.status}</td></tr>
            <tr><th>Amount</th><td>{formatAmount(detail.amount, detail.currency)}</td></tr>
            <tr><th>Date</th><td>{formatDate(detail.created)}</td></tr>
            {detail.customerName && <tr><th>Customer Name</th><td>{detail.customerName}</td></tr>}
            {detail.customerEmail && <tr><th>Customer Email</th><td>{detail.customerEmail}</td></tr>}
            {detail.paymentReference && <tr><th>Payment Reference</th><td><code>{detail.paymentReference}</code></td></tr>}
          </tbody>
        </table>
      </section>

      {detail.lineItems.length > 0 && (
        <section>
          <h2>Line Items</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.lineItems.map((item) => (
                <tr>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{formatAmount(item.unitPrice, detail.currency)}</td>
                  <td>{formatAmount(item.total, detail.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {Object.keys(detail.metadata).length > 0 && (
        <section>
          <h2>Metadata</h2>
          <table>
            <tbody>
              {Object.entries(detail.metadata).map(([key, value]) => (
                <tr><th>{key}</th><td>{value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {reservations.length > 0 && (
        <section>
          <h2>Stock Reservations</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Product ID</th>
                <th>Quantity</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr>
                  <td>{r.id}</td>
                  <td>{r.product_id}</td>
                  <td>{r.quantity}</td>
                  <td>{STATUS_LABELS[r.status] ?? r.status}</td>
                  <td>{formatDate(r.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {detail.dashboardUrl && (
        <section>
          <a href={detail.dashboardUrl} target="_blank" rel="noopener noreferrer">
            View in {PROVIDER_NAMES[detail.providerType]} Dashboard
          </a>
        </section>
      )}

      {detail.paymentReference && detail.status === "paid" && (
        <section>
          <h2>Refund</h2>
          <p>To refund this payment, type <strong>REFUND</strong> in the box below and click the button.</p>
          <form method="POST" action={`/admin/orders/${encodeURIComponent(detail.id)}/refund`}>
            <input type="hidden" name="csrf_token" value={session.csrfToken} />
            <label for="confirm_refund">Type REFUND to confirm:</label>
            <input type="text" id="confirm_refund" name="confirm_refund" required placeholder="REFUND" autocomplete="off" />
            <button type="submit" class="danger">Issue Refund</button>
          </form>
        </section>
      )}
    </Layout>
  );
