import { createHmac, timingSafeEqual } from "crypto";
import type { Config, MonitorTarget, WebhookGroup } from "./config.js";

/** 一次 Webhook 请求解析到的配置与分流结果（多 yaml 时用于选对那份 Config） */
export interface WebhookDispatch {
  config: Config;
  matchedGroup?: WebhookGroup;
  matchedTarget?: MonitorTarget;
}

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
 * 用 config 中每个 target 的 signing_key 匹配入站签名，返回匹配到的 target（多 Webhook 每 target 一个 key 时用）
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

/**
 * 多组模式：用每个 group 的 signing_key 匹配入站签名，返回匹配到的组（该组内多条规则，收到 event 后只在该组内匹配）
 */
export function getGroupForSignature(
  config: Config,
  body: string,
  signature: string
): WebhookGroup | null {
  const groups = config.webhookGroups;
  if (!groups?.length) return null;
  for (const group of groups) {
    const key = group.signingKey?.trim();
    if (key && isValidSignature(body, signature, key)) return group;
  }
  return null;
}

/**
 * 按签名在多个 Config 中依次匹配（顺序与 loadConfigs 一致）。
 * 单 Config 时保留 `SIGNING_KEYS` 兜底：验签通过后视为命中该唯一配置、整表匹配。
 * 多 Config 时不用 env 兜底，避免误路由到错误项目。
 */
export function resolveWebhookDispatch(
  configs: Config[],
  body: string,
  signature: string,
  envSigningKeys: string[]
): WebhookDispatch | null {
  if (!configs.length) return null;

  for (const config of configs) {
    const matchedGroup = config.webhookGroups?.length
      ? getGroupForSignature(config, body, signature)
      : null;
    if (matchedGroup) {
      return { config, matchedGroup };
    }
    const validSingle =
      config.singleWebhook &&
      config.singleWebhookSigningKey &&
      isValidSignature(body, signature, config.singleWebhookSigningKey);
    if (validSingle) {
      return { config };
    }
    const matchedTarget = getTargetForSignature(config, body, signature);
    if (matchedTarget) {
      return { config, matchedTarget };
    }
  }

  if (configs.length === 1 && envSigningKeys.length > 0) {
    const ok = envSigningKeys.some((k) => isValidSignature(body, signature, k));
    if (ok) {
      return { config: configs[0]! };
    }
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
