/**
 * Admin dashboard page template
 */

import type { AdminSession } from "#lib/types.ts";
import { Layout } from "#templates/layout.tsx";
import { AdminNav } from "#templates/admin/nav.tsx";

/**
 * Admin dashboard page
 * Will be updated to show products in Step 3
 */
export const adminDashboardPage = (
  session: AdminSession,
): string => {
  return String(
    <Layout title="Dashboard">
      <AdminNav session={session} />
      <p>Product management will be added here.</p>
    </Layout>
  );
};
