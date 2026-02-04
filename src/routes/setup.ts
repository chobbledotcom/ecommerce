/**
 * Setup routes - initial system configuration
 */

import { settingsApi } from "#lib/db/settings.ts";
import { ErrorCode, logDebug, logError } from "#lib/logger.ts";
import { createRouter, defineRoutes } from "#routes/router.ts";
import {
  generateSecureToken,
  htmlResponse,
  htmlResponseWithCookie,
  parseCookies,
  parseFormData,
  redirect,
  validateCsrfToken,
} from "#routes/utils.ts";
import { parseSetupForm } from "#templates/fields.ts";
import { setupCompletePage, setupPage } from "#templates/setup.tsx";

/** Cookie for CSRF token with standard security options */
const setupCsrfCookie = (token: string): string =>
  `setup_csrf=${token}; HttpOnly; Secure; SameSite=Strict; Path=/setup; Max-Age=3600`;

/** Response helper with setup CSRF cookie - curried to thread token through */
const setupResponse =
  (token: string) =>
  (error?: string, status = 200) =>
    htmlResponseWithCookie(setupCsrfCookie(token))(
      setupPage(error, token),
      status,
    );

/** Validate setup form — delegates to typed parser, adds agreement check */
const validateSetupForm = (form: URLSearchParams) => {
  logDebug("Setup", "Validating form data...");

  // Check Data Controller Agreement first (outside the form framework)
  if (form.get("accept_agreement") !== "yes") {
    logDebug("Setup", "Agreement not accepted");
    return { valid: false as const, error: "You must accept the Data Controller Agreement to continue" };
  }

  const result = parseSetupForm(form);
  if (!result.valid) logDebug("Setup", `Validation failed: ${result.error}`);
  else logDebug("Setup", "Validation passed");
  return result;
};

/**
 * Handle GET /setup/
 * Uses double-submit cookie pattern for CSRF protection
 */
const handleSetupGet = async (
  isSetupComplete: () => Promise<boolean>,
): Promise<Response> => {
  if (await isSetupComplete()) {
    return redirect("/");
  }
  const csrfToken = generateSecureToken();
  return setupResponse(csrfToken)();
};

/**
 * Handle POST /setup/
 * Validates CSRF token using double-submit cookie pattern
 */
const handleSetupPost = async (
  request: Request,
  isSetupComplete: () => Promise<boolean>,
): Promise<Response> => {
  logDebug("Setup", "POST request received");

  if (await isSetupComplete()) {
    logDebug("Setup", "Setup already complete, redirecting");
    return redirect("/");
  }

  // Validate CSRF token (double-submit cookie pattern)
  const cookies = parseCookies(request);
  const cookieCsrf = cookies.get("setup_csrf") || "";
  logDebug("Setup", `Cookies parsed: ${Array.from(cookies.keys()).join(", ")}`);
  logDebug(
    "Setup",
    `CSRF cookie present: ${!!cookieCsrf} length: ${cookieCsrf.length}`,
  );

  const form = await parseFormData(request);
  const formCsrf = form.get("csrf_token") || "";
  logDebug(
    "Setup",
    `CSRF form present: ${!!formCsrf} length: ${formCsrf.length}`,
  );

  if (!cookieCsrf || !formCsrf || !validateCsrfToken(cookieCsrf, formCsrf)) {
    logError({ code: ErrorCode.AUTH_CSRF_MISMATCH, detail: "setup form" });
    const newCsrfToken = generateSecureToken();
    return setupResponse(newCsrfToken)(
      "Invalid or expired form. Please try again.",
      403,
    );
  }

  logDebug("Setup", "CSRF validation passed, validating form...");

  const validation = validateSetupForm(form);

  if (!validation.valid) {
    logError({ code: ErrorCode.VALIDATION_FORM, detail: "setup" });
    // Keep the same CSRF token for validation errors
    return htmlResponse(setupPage(validation.error, formCsrf), 400);
  }

  logDebug("Setup", "Form validation passed, completing setup...");

  try {
    await settingsApi.completeSetup(
      validation.username,
      validation.password,
      validation.currency,
    );
    logDebug("Setup", "Setup completed successfully!");
    return redirect("/setup/complete");
  } catch (error) {
    logError({ code: ErrorCode.DB_QUERY, detail: "setup completion" });
    throw error;
  }
};

/**
 * Handle GET /setup/complete - setup success page
 */
const handleSetupComplete = async (
  isSetupComplete: () => Promise<boolean>,
): Promise<Response> => {
  if (!(await isSetupComplete())) {
    return redirect("/setup/");
  }
  return htmlResponse(setupCompletePage());
};

/**
 * Create setup router with injected isSetupComplete dependency
 * Uses factory pattern since setup routes need to check completion status
 */
export const createSetupRouter = (
  isSetupComplete: () => Promise<boolean>,
): ReturnType<typeof createRouter> => {
  const setupRoutes = defineRoutes({
    "GET /setup/complete": () => handleSetupComplete(isSetupComplete),
    "GET /setup": () => handleSetupGet(isSetupComplete),
    "POST /setup": (request) => handleSetupPost(request, isSetupComplete),
  });

  return createRouter(setupRoutes);
};
