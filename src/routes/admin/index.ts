/**
 * Admin routes - combined from individual route modules
 */

import { authRoutes } from "#routes/admin/auth.ts";
import { dashboardRoutes } from "#routes/admin/dashboard.ts";
import { orderRoutes } from "#routes/admin/orders.ts";
import { productRoutes, routeProductDynamic } from "#routes/admin/products.ts";
import { sessionsRoutes } from "#routes/admin/sessions.ts";
import { settingsRoutes } from "#routes/admin/settings.ts";
import { usersRoutes } from "#routes/admin/users.ts";
import { createRouter } from "#routes/router.ts";

/** Combined admin routes (static route definitions) */
const adminRoutes = {
  ...productRoutes,
  ...dashboardRoutes,
  ...orderRoutes,
  ...authRoutes,
  ...settingsRoutes,
  ...sessionsRoutes,
  ...usersRoutes,
};

/** Static admin router */
const routeAdminStatic = createRouter(adminRoutes);

/** Route admin requests — static routes first, then dynamic product routes */
export const routeAdmin = async (
  request: Request,
  path: string,
  method: string,
  server?: import("#routes/types.ts").ServerContext,
): Promise<Response | null> =>
  (await routeAdminStatic(request, path, method, server)) ??
  (await routeProductDynamic(request, path, method));
