/**
 * Admin dashboard helpers and activity log route
 */

import { getAllActivityLog } from "#lib/db/activityLog.ts";
import { defineRoutes } from "#routes/router.ts";
import { htmlResponse, requireSessionOr } from "#routes/utils.ts";
import { adminGlobalActivityLogPage } from "#templates/admin/activityLog.tsx";
import { adminLoginPage } from "#templates/admin/login.tsx";

/** Login page response helper */
export const loginResponse = (error?: string, status = 200) =>
  htmlResponse(adminLoginPage(error), status);

/** Maximum number of log entries to display */
const LOG_DISPLAY_LIMIT = 200;

/**
 * Handle GET /admin/log
 */
const handleAdminLog = (request: Request): Promise<Response> =>
  requireSessionOr(request, async (session) => {
    const entries = await getAllActivityLog(LOG_DISPLAY_LIMIT + 1);
    const truncated = entries.length > LOG_DISPLAY_LIMIT;
    const displayEntries = truncated ? entries.slice(0, LOG_DISPLAY_LIMIT) : entries;
    return htmlResponse(adminGlobalActivityLogPage(displayEntries, truncated, session));
  });

/** Dashboard routes (activity log only — product list is in products.ts) */
export const dashboardRoutes = defineRoutes({
  "GET /admin/log": (request) => handleAdminLog(request),
});
