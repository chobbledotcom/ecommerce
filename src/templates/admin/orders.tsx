/**
 * Admin order listing template
 */

import type { PaymentSessionListResult } from "#lib/payments.ts";
import type { AdminSession } from "#lib/types.ts";
import { Layout } from "#templates/layout.tsx";
import { AdminNav } from "#templates/admin/nav.tsx";

/** Format amount from smallest unit */
const formatAmount = (amount: number | null, currency: string | null): string => {
  if (amount === null) return "-";
  const formatted = (amount / 100).toFixed(2);
  return currency ? `${formatted} ${currency.toUpperCase()}` : formatted;
};

/**
 * Admin orders list page
 */
export const adminOrdersPage = (
  result: PaymentSessionListResult,
  session: AdminSession,
  lastId?: string,
): string => {
  const { sessions, hasMore } = result;
  return String(
    <Layout title="Orders">
      <AdminNav session={session} />
      <h1>Orders</h1>
      {sessions.length === 0
        ? <p>No orders yet.</p>
        : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>ID</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Customer</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr>
                  <td>{s.created ? new Date(s.created).toLocaleDateString() : "-"}</td>
                  <td><a href={`/admin/orders/${encodeURIComponent(s.id)}`}><code>{s.id.slice(0, 20)}</code></a></td>
                  <td>{s.status}</td>
                  <td>{formatAmount(s.amount, s.currency)}</td>
                  <td>{s.customerEmail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {hasMore && lastId && (
        <a href={`/admin/orders?after=${encodeURIComponent(lastId)}`}>Next page</a>
      )}
    </Layout>
  );
};
