/**
 * Webhook notification module
 * Sends order data to a configured webhook URL on checkout completion
 */

import { logActivity } from "#lib/db/activityLog.ts";
import { ErrorCode, logError } from "#lib/logger.ts";

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

/**
 * Send a webhook payload to a URL
 * Fires and forgets - errors are logged but don't block order processing
 */
export const sendWebhook = async (
  webhookUrl: string,
  payload: WebhookPayload,
): Promise<void> => {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  await sendWebhook(webhookUrl, payload);
};
