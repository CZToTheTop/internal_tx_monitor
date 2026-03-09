import { createHmac } from "crypto";

/**
 * 验证 Alchemy Webhook 签名
 * @see https://docs.alchemy.com/reference/notify-api-quickstart#validate-the-signature-received
 */
export function isValidSignature(
  body: string,
  signature: string,
  signingKey: string
): boolean {
  const hmac = createHmac("sha256", signingKey);
  hmac.update(body, "utf8");
  const digest = hmac.digest("hex");
  return signature === digest;
}

/** Alchemy Webhook 事件 payload 结构 */
export interface AlchemyWebhookEvent {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    data?: {
      block?: {
        number?: number;
        hash?: string;
        timestamp?: string;
        logs?: unknown[];
        transactions?: unknown[];
        callTracerTraces?: unknown[];
      };
    };
    sequenceNumber?: string;
  };
}
