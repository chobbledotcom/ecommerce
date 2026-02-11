/**
 * Webhook notification module
 * Sends order data to a configured webhook URL on checkout completion
 *
 * Security: Outbound webhooks are signed with HMAC-SHA256 using a
 * configured secret so receivers can verify authenticity.
 */

import { logActivity } from "#lib/db/activityLog.ts";
import { ErrorCode, logError } from "#lib/logger.ts";
import { signTimestampedPayload as signWebhookPayload } from "#lib/payment-crypto.ts";

/** Line item in the webhook payload */
export type WebhookLineItem = {
  sku: string;
  name: string;
  unit_price: number;
  quantity: number;
};

/** Payload sent to the configured webhook URL on order completion */
export type WebhookPayload = {
  event_type: "order.completed";
  provider_session_id: string;
  currency: string;
  line_items: WebhookLineItem[];
  timestamp: string;
};

export { signWebhookPayload };

/**
 * Send a webhook payload to a URL
 * Fires and forgets - errors are logged but don't block order processing
 *
 * When a webhookSecret is provided the request includes an
 * X-Webhook-Signature header so receivers can verify authenticity.
 */
export const sendWebhook = async (
  webhookUrl: string,
  payload: WebhookPayload,
  webhookSecret: string | null = null,
): Promise<void> => {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (webhookSecret) {
      const { signature } = await signWebhookPayload(body, webhookSecret);
      headers["X-Webhook-Signature"] = signature;
    }

    await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch {
    logError({ code: ErrorCode.WEBHOOK_SEND });
  }
};

/**
 * Log order completion and send webhook notification
 */
export const logAndNotifyOrder = async (
  providerSessionId: string,
  lineItems: WebhookLineItem[],
  currency: string,
  webhookUrl: string | null,
  webhookSecret: string | null = null,
): Promise<void> => {
  await logActivity(`Order completed: ${providerSessionId}`);

  if (!webhookUrl) return;

  const payload: WebhookPayload = {
    event_type: "order.completed",
    provider_session_id: providerSessionId,
    currency,
    line_items: lineItems,
    timestamp: new Date().toISOString(),
  };
  await sendWebhook(webhookUrl, payload, webhookSecret);
};
