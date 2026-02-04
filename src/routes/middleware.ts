/**
 * Middleware functions for request processing
 */

import { compact } from "#fp";
import { getAllowedDomain, getAllowedOrigins } from "#lib/config.ts";

/**
 * Security headers for all responses
 */
const BASE_SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-robots-tag": "noindex, nofollow",
};

/**
 * Build CSP header value
 * Restricts resources to self and prevents clickjacking for non-embeddable pages
 */
const buildCspHeader = (embeddable: boolean): string =>
  compact([
    // Frame ancestors - prevent clickjacking (except for embeddable pages)
    !embeddable && "frame-ancestors 'none'",
    // Restrict resource loading to self (prevents loading from unexpected domains)
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Allow inline styles
    "script-src 'self' 'unsafe-inline'", // Allow inline scripts
    "form-action 'self' https://checkout.stripe.com", // Restrict form submissions to self + Stripe checkout redirect
  ]).join("; ");

/**
 * Get security headers for a response
 * @param embeddable - Whether the page should be embeddable in iframes
 */
export const getSecurityHeaders = (
  embeddable: boolean,
): Record<string, string> => ({
  ...BASE_SECURITY_HEADERS,
  ...(!embeddable && { "x-frame-options": "DENY" }),
  "content-security-policy": buildCspHeader(embeddable),
});

/**
 * Check if a path is embeddable — currently no pages are embeddable
 */
export const isEmbeddablePath = (_path: string): boolean => false;

/**
 * Extract hostname from Host header (removes port if present)
 */
const getHostname = (host: string): string => {
  const colonIndex = host.indexOf(":");
  return colonIndex === -1 ? host : host.slice(0, colonIndex);
};

/**
 * Validate request domain against ALLOWED_DOMAIN.
 * Checks the Host header to prevent the app being served through unauthorized proxies.
 * Returns true if the request should be allowed.
 */
export const isValidDomain = (request: Request): boolean => {
  const host = request.headers.get("host");
  if (!host) {
    return false;
  }
  return getHostname(host) === getAllowedDomain();
};

/** Check if a path is a JSON API endpoint */
export const isApiPath = (path: string): boolean =>
  path.startsWith("/api/");

/**
 * Check if path is a webhook endpoint that accepts JSON
 */
export const isWebhookPath = (path: string): boolean =>
  path === "/payment/webhook";

/**
 * Validate Content-Type for POST requests
 * Returns true if the request is valid (not a POST, or has correct Content-Type)
 * Webhook and API endpoints accept application/json, all others require form-urlencoded
 */
export const isValidContentType = (request: Request, path: string): boolean => {
  if (request.method !== "POST") {
    return true;
  }
  const contentType = request.headers.get("content-type") || "";

  // Webhook and API endpoints accept JSON
  if (isWebhookPath(path) || isApiPath(path)) {
    return contentType.startsWith("application/json");
  }

  // All other POST endpoints require form-urlencoded
  return contentType.startsWith("application/x-www-form-urlencoded");
};

/**
 * Create Content-Type rejection response
 */
export const contentTypeRejectionResponse = (): Response =>
  new Response("Bad Request: Invalid Content-Type", {
    status: 400,
    headers: {
      "content-type": "text/plain",
      ...getSecurityHeaders(false),
    },
  });

/**
 * Create domain rejection response
 */
export const domainRejectionResponse = (): Response =>
  new Response("Forbidden: Invalid domain", {
    status: 403,
    headers: {
      "content-type": "text/plain",
      ...getSecurityHeaders(false),
    },
  });

/** Clone a response with additional headers merged in */
const withHeaders = (
  response: Response,
  extra: Record<string, string>,
): Response => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * Apply security headers to a response
 */
export const applySecurityHeaders = (
  response: Response,
  embeddable: boolean,
): Response => withHeaders(response, getSecurityHeaders(embeddable));

/**
 * Build CORS headers for an origin if it's in the allowed list.
 * Returns empty object if origin is not allowed.
 */
export const corsHeaders = async (
  origin: string | null,
): Promise<Record<string, string>> => {
  if (!origin) return {};
  const allowed = await getAllowedOrigins();
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
};

/**
 * Handle OPTIONS preflight for API paths
 */
export const handlePreflight = async (
  request: Request,
): Promise<Response | null> => {
  const origin = request.headers.get("origin");
  const headers = await corsHeaders(origin);
  if (Object.keys(headers).length === 0) return null;
  return new Response(null, { status: 204, headers });
};

/**
 * Apply CORS headers to a response
 */
export const applyCorsHeaders = async (
  response: Response,
  request: Request,
): Promise<Response> => {
  const origin = request.headers.get("origin");
  const cors = await corsHeaders(origin);
  if (Object.keys(cors).length === 0) return response;
  return withHeaders(response, cors);
};
