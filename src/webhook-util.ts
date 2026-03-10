import { createHmac, timingSafeEqual } from "crypto";

/**
 * 验证 Alchemy Webhook 签名（使用 constant-time 比较防 timing attack）
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
  const sigBuf = Buffer.from(signature, "hex");
  const digBuf = Buffer.from(digest, "hex");
  if (sigBuf.length !== digBuf.length || sigBuf.length !== 32) return false;
  try {
    return timingSafeEqual(sigBuf, digBuf);
  } catch {
    return false;
  }
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
