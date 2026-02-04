/**
 * Admin order listing and detail routes
 * Fetches order data from the active payment provider's API
 */

import { getReservationsBySession, restockFromRefund } from "#lib/db/reservations.ts";
import { getActivePaymentProvider } from "#lib/payments.ts";
import { defineRoutes } from "#routes/router.ts";
import { getSearchParam, htmlResponse, requireSessionOr, withAuthForm } from "#routes/utils.ts";
import { adminOrderDetailPage } from "#templates/admin/order-detail.tsx";
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

/**
 * GET /admin/orders/:orderRef — order detail view
 */
const handleOrderDetail = (
  request: Request,
  params: Record<string, string | undefined>,
): Promise<Response> =>
  requireSessionOr(request, async (session) => {
    const orderRef = params.orderRef!;
    const provider = await getActivePaymentProvider();
    if (!provider) return htmlResponse("Payment provider not configured", 400);

    const detail = await provider.retrieveSessionDetail(orderRef);
    if (!detail) return htmlResponse("Order not found", 404);

    const reservations = await getReservationsBySession(orderRef);
    const success = getSearchParam(request, "success") ?? undefined;

    return htmlResponse(adminOrderDetailPage(detail, reservations, session, undefined, success));
  });

/** Render the detail page with an error message */
const detailError = async (
  orderRef: string,
  session: Parameters<typeof adminOrderDetailPage>[2],
  detail: Parameters<typeof adminOrderDetailPage>[0],
  error: string,
  status: number,
): Promise<Response> => {
  const reservations = await getReservationsBySession(orderRef);
  return htmlResponse(adminOrderDetailPage(detail, reservations, session, error), status);
};

/**
 * POST /admin/orders/:orderRef/refund — issue a refund
 */
const handleRefund = (
  request: Request,
  params: Record<string, string | undefined>,
): Promise<Response> =>
  withAuthForm(request, async (session, form) => {
    const orderRef = params.orderRef!;

    const provider = await getActivePaymentProvider();
    if (!provider) return htmlResponse("Payment provider not configured", 400);

    const detail = await provider.retrieveSessionDetail(orderRef);
    if (!detail) return htmlResponse("Order not found", 404);

    const confirmRefund = form.get("confirm_refund") ?? "";
    if (confirmRefund !== "REFUND") {
      return detailError(orderRef, session, detail, "Type REFUND exactly to confirm.", 400);
    }

    if (!detail.paymentReference) {
      return detailError(orderRef, session, detail, "No payment reference found for this order.", 400);
    }

    const refundResult = await provider.refundPayment(detail.paymentReference);
    if (!refundResult) {
      return detailError(orderRef, session, detail, "Refund failed. Check the provider dashboard for details.", 500);
    }

    await restockFromRefund(orderRef);

    return new Response(null, {
      status: 302,
      headers: { location: `/admin/orders/${encodeURIComponent(orderRef)}?success=Refund+issued+successfully` },
    });
  });

/** Order routes */
export const orderRoutes = defineRoutes({
  "GET /admin/orders": (request) => handleOrdersList(request),
  "GET /admin/orders/:orderRef": (request, params) => handleOrderDetail(request, params),
  "POST /admin/orders/:orderRef/refund": (request, params) => handleRefund(request, params),
});
