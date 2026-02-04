/**
 * Form field definitions for all forms
 */

import { createFormParser } from "#lib/forms.tsx";
import type { Field } from "#lib/forms.tsx";
import type { AdminLevel } from "#lib/types.ts";

/**
 * Validate email format
 */
export const validateEmail = (value: string): string | null => {
  // Basic email format check - more permissive than strict RFC but catches common issues
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return "Please enter a valid email address";
  }
  return null;
};

/**
 * Validate phone number format
 */
export const validatePhone = (value: string): string | null => {
  // Allow digits, spaces, hyphens, parentheses, plus sign
  const phoneRegex = /^[+\d][\d\s\-()]{5,}$/;
  if (!phoneRegex.test(value)) {
    return "Please enter a valid phone number";
  }
  return null;
};

/** Validate username format: alphanumeric, hyphens, underscores, 2-32 chars */
export const validateUsername = (value: string): string | null => {
  if (value.length < 2) return "Username must be at least 2 characters";
  if (value.length > 32) return "Username must be 32 characters or fewer";
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return "Username may only contain letters, numbers, hyphens, and underscores";
  }
  return null;
};

/**
 * Login form field definitions
 */
export const loginFields: Field[] = [
  { name: "username", label: "Username", type: "text", required: true },
  { name: "password", label: "Password", type: "password", required: true },
];

/**
 * Setup form field definitions
 * Note: Stripe keys are now configured via environment variables
 */
export const setupFields: Field[] = [
  {
    name: "admin_username",
    label: "Admin Username *",
    type: "text",
    required: true,
    hint: "Letters, numbers, hyphens, underscores (2-32 chars)",
    validate: validateUsername,
  },
  {
    name: "admin_password",
    label: "Admin Password *",
    type: "password",
    required: true,
    hint: "Minimum 8 characters",
  },
  {
    name: "admin_password_confirm",
    label: "Confirm Admin Password *",
    type: "password",
    required: true,
  },
  {
    name: "currency_code",
    label: "Currency Code",
    type: "text",
    pattern: "[A-Z]{3}",
    hint: "3-letter ISO code (e.g., GBP, USD, EUR)",
  },
];

/**
 * Change password form field definitions
 */
export const changePasswordFields: Field[] = [
  {
    name: "current_password",
    label: "Current Password",
    type: "password",
    required: true,
  },
  {
    name: "new_password",
    label: "New Password",
    type: "password",
    required: true,
    hint: "Minimum 8 characters",
  },
  {
    name: "new_password_confirm",
    label: "Confirm New Password",
    type: "password",
    required: true,
  },
];

/**
 * Stripe key settings form field definitions
 */
export const stripeKeyFields: Field[] = [
  {
    name: "stripe_secret_key",
    label: "Stripe Secret Key",
    type: "password",
    required: true,
    placeholder: "sk_live_... or sk_test_...",
    hint: "Enter a new key to update",
  },
];

/**
 * Square access token and location form field definitions
 */
export const squareAccessTokenFields: Field[] = [
  {
    name: "square_access_token",
    label: "Square Access Token",
    type: "password",
    required: true,
    placeholder: "EAAAl...",
    hint: "Your Square application's access token",
  },
  {
    name: "square_location_id",
    label: "Location ID",
    type: "text",
    required: true,
    placeholder: "L...",
    hint: "Your Square location ID (found in Square Dashboard under Locations)",
  },
];

/**
 * Square webhook settings form field definitions
 */
export const squareWebhookFields: Field[] = [
  {
    name: "square_webhook_signature_key",
    label: "Webhook Signature Key",
    type: "password",
    required: true,
    hint: "The signature key from your Square webhook subscription",
  },
];

/**
 * Invite user form field definitions
 */
export const inviteUserFields: Field[] = [
  {
    name: "username",
    label: "Username",
    type: "text",
    required: true,
    hint: "Letters, numbers, hyphens, underscores (2-32 chars)",
    validate: validateUsername,
  },
  {
    name: "admin_level",
    label: "Role",
    type: "select",
    required: true,
    options: [
      { value: "manager", label: "Manager" },
      { value: "owner", label: "Owner" },
    ],
  },
];

/**
 * Product form field definitions
 */
export const productFields: Field[] = [
  {
    name: "name",
    label: "Product Name",
    type: "text",
    required: true,
  },
  {
    name: "sku",
    label: "SKU",
    type: "text",
    required: true,
    hint: "Unique product identifier (e.g. WIDGET-01)",
  },
  {
    name: "description",
    label: "Description",
    type: "textarea",
  },
  {
    name: "unit_price",
    label: "Price (in smallest unit, e.g. pence/cents)",
    type: "number",
    required: true,
    min: 0,
    hint: "Enter 1500 for 15.00",
  },
  {
    name: "stock",
    label: "Stock",
    type: "number",
    required: true,
    hint: "-1 for unlimited, 0 for out of stock",
  },
  {
    name: "active",
    label: "Active",
    type: "select",
    options: [
      { value: "1", label: "Active" },
      { value: "0", label: "Inactive" },
    ],
  },
];

/**
 * Allowed origins form field definitions
 */
export const allowedOriginsFields: Field[] = [
  {
    name: "allowed_origins",
    label: "Allowed Origins",
    type: "textarea",
    hint: "Comma-separated origins (e.g. https://myshop.com, https://staging.myshop.com)",
  },
];

/**
 * Currency form field definitions
 */
export const currencyFields: Field[] = [
  {
    name: "currency_code",
    label: "Currency Code",
    type: "text",
    required: true,
    pattern: "[A-Z]{3}",
    hint: "3-letter ISO code (e.g., GBP, USD, EUR)",
  },
];

/**
 * Join (set password) form field definitions
 */
export const joinFields: Field[] = [
  {
    name: "password",
    label: "Password",
    type: "password",
    required: true,
    hint: "Minimum 8 characters",
  },
  {
    name: "password_confirm",
    label: "Confirm Password",
    type: "password",
    required: true,
  },
];

// ---------------------------------------------------------------------------
// Typed form parsers — parse at the boundary, return strong types
// ---------------------------------------------------------------------------

/**
 * Validate a password + confirmation pair.
 * Returns error string or null on success.
 */
const MIN_PASSWORD_LENGTH = 8;

const checkPasswords = (
  password: string,
  confirm: string,
  label = "Password",
  pluralLabel = "Passwords",
): string | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return `${label} must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password !== confirm) return `${pluralLabel} do not match`;
  return null;
};

/** Validate a 3-letter ISO currency code, returns uppercased code or error */
const parseCurrency = (raw: string, fallback?: string): string | { code: string } => {
  const code = (raw || fallback || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return "Currency code must be 3 uppercase letters";
  return { code };
};

/** Parse login form → { username, password } */
export const parseLoginCredentials = createFormParser(
  loginFields,
  (v) => ({
    username: v.username as string,
    password: v.password as string,
  }),
);

/** Parse setup form → { username, password, currency } */
export const parseSetupForm = createFormParser(
  setupFields,
  (v) => {
    const pw = v.admin_password as string;
    const confirm = v.admin_password_confirm as string;
    const pwError = checkPasswords(pw, confirm);
    if (pwError) return pwError;
    const curr = parseCurrency(v.currency_code as string, "GBP");
    if (typeof curr === "string") return curr;
    return { username: v.admin_username as string, password: pw, currency: curr.code };
  },
);

/** Parse join (invite acceptance) form → { password } */
export const parseJoinForm = createFormParser(
  joinFields,
  (v) => {
    const pw = v.password as string;
    const confirm = v.password_confirm as string;
    const error = checkPasswords(pw, confirm);
    if (error) return error;
    return { password: pw };
  },
);

/** Parse change-password form → { currentPassword, newPassword } */
export const parseChangePassword = createFormParser(
  changePasswordFields,
  (v) => {
    const newPw = v.new_password as string;
    const confirm = v.new_password_confirm as string;
    const error = checkPasswords(newPw, confirm, "New password", "New passwords");
    if (error) return error;
    return { currentPassword: v.current_password as string, newPassword: newPw };
  },
);

/** Typed product input — what the product form produces */
export type ProductFormData = {
  name: string;
  sku: string;
  description: string;
  unitPrice: number;
  stock: number;
  active: number;
};

/** Parse product form → ProductFormData */
export const parseProductForm = createFormParser(
  productFields,
  (v): ProductFormData => ({
    name: v.name as string,
    sku: v.sku as string,
    description: (v.description as string) ?? "",
    unitPrice: v.unit_price as number,
    stock: v.stock as number,
    active: Number(v.active ?? 1),
  }),
);

/** Parse invite-user form → { username, adminLevel } with validated role */
export const parseInviteUserForm = createFormParser(
  inviteUserFields,
  (v): { username: string; adminLevel: AdminLevel } | string => {
    const level = v.admin_level as string;
    if (level !== "owner" && level !== "manager") return "Invalid role";
    return { username: v.username as string, adminLevel: level };
  },
);

/** Parse Stripe key form → { stripeSecretKey } */
export const parseStripeKeyForm = createFormParser(
  stripeKeyFields,
  (v) => ({ stripeSecretKey: v.stripe_secret_key as string }),
);

/** Parse Square credentials form → { accessToken, locationId } */
export const parseSquareTokenForm = createFormParser(
  squareAccessTokenFields,
  (v) => ({
    accessToken: v.square_access_token as string,
    locationId: v.square_location_id as string,
  }),
);

/** Parse Square webhook form → { signatureKey } */
export const parseSquareWebhookForm = createFormParser(
  squareWebhookFields,
  (v) => ({ signatureKey: v.square_webhook_signature_key as string }),
);

/** Parse currency settings form → { currencyCode } */
export const parseCurrencyForm = createFormParser(
  currencyFields,
  (v): { currencyCode: string } | string => {
    const curr = parseCurrency(v.currency_code as string);
    if (typeof curr === "string") return curr;
    return { currencyCode: curr.code };
  },
);
