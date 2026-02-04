/**
 * Admin order listing routes
 * Fetches order data from the active payment provider's API
 */

import { getActivePaymentProvider } from "#lib/payments.ts";
import { defineRoutes } from "#routes/router.ts";
import { getSearchParam, htmlResponse, requireSessionOr } from "#routes/utils.ts";
import { adminOrdersPage } from "#templates/admin/orders.tsx";

/** Number of orders to show per page */
const ORDERS_PER_PAGE = 20;

/**
 * GET /admin/orders — list recent orders from payment provider
 */
const handleOrdersList = (request: Request): Promise<Response> =>
  requireSessionOr(request, async (session) => {
    const provider = await getActivePaymentProvider();
    if (!provider) {
      return htmlResponse(adminOrdersPage([], false, session));
    }

    const after = getSearchParam(request, "after") ?? undefined;
    const result = await provider.listSessions({
      limit: ORDERS_PER_PAGE,
      startingAfter: after,
    });

    const lastSession = result.sessions.at(-1);
    const lastId = lastSession?.id;

    return htmlResponse(adminOrdersPage(result.sessions, result.hasMore, session, lastId));
  });

/** Order routes */
export const orderRoutes = defineRoutes({
  "GET /admin/orders": (request) => handleOrdersList(request),
});
