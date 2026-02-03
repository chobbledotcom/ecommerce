/**
 * Types for the ecommerce backend
 */

/** Product in the catalog */
export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  unit_price: number; // in smallest currency unit (pence/cents)
  stock: number; // 0 = out of stock, -1 = unlimited
  active: number; // 0 = hidden from catalog
  created: string;
}

/** Stock reservation status */
export type ReservationStatus = "pending" | "confirmed" | "expired";

/** Stock reservation tracking in-flight checkout sessions */
export interface Reservation {
  id: number;
  product_id: number;
  quantity: number;
  provider_session_id: string; // Stripe session ID or Square order ID
  status: ReservationStatus;
  created: string;
}

/** Legacy Event type — retained for payment provider compatibility */
export interface Event {
  id: number;
  name: string;
  description: string;
  slug: string;
  slug_index: string;
  created: string;
  max_attendees: number;
  thank_you_url: string | null;
  unit_price: number | null;
  max_quantity: number;
  webhook_url: string | null;
  active: number;
  fields: EventFields;
  closes_at: string | null;
}

/** Contact fields setting for an event */
export type EventFields = "email" | "phone" | "both";

export interface Settings {
  key: string;
  value: string;
}

export interface Session {
  token: string; // Contains the hashed token for DB storage
  csrf_token: string;
  expires: number;
  wrapped_data_key: string | null;
  user_id: number;
}

/** Admin role levels */
export type AdminLevel = "owner" | "manager";

/** Session data needed by admin page templates */
export type AdminSession = {
  readonly csrfToken: string;
  readonly adminLevel: AdminLevel;
};

export interface User {
  id: number;
  username_hash: string; // encrypted at rest, decrypted to display
  username_index: string; // HMAC hash for lookups
  password_hash: string; // PBKDF2 hash encrypted at rest
  wrapped_data_key: string | null; // wrapped with user's KEK
  admin_level: string; // encrypted "owner" or "manager"
  invite_code_hash: string | null; // encrypted SHA-256 of invite token, null after password set
  invite_expiry: string | null; // encrypted ISO 8601, null after password set
}

/** Payment session returned from provider listing */
export interface PaymentSession {
  id: string;
  status: string;
  amount: number | null;
  currency: string | null;
  customerEmail: string | null;
  created: string;
  url: string | null;
}
