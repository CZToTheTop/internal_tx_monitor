import { createHmac, timingSafeEqual } from "crypto";
import type { Config, MonitorTarget } from "./config.js";

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

/**
 * 用 config 中每个 target 的 signing_key 匹配入站签名，返回匹配到的 target，用于区分是 log/tx/internal_calls
 */
export function getTargetForSignature(
  config: Config,
  body: string,
  signature: string
): MonitorTarget | null {
  for (const target of config.targets) {
    const key = target.signing_key?.trim();
    if (key && isValidSignature(body, signature, key)) return target;
  }
  return null;
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
