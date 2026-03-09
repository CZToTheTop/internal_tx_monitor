import type { AlchemyWebhookEvent } from "./webhook-util.js";

function formatEvent(_event: AlchemyWebhookEvent): void {
  // 静默处理，可在此接入自定义逻辑（数据库、告警等）
}

/**
 * 默认事件处理器：格式化输出到控制台
 * 可替换为写入数据库、发送告警等
 */
export function defaultEventHandler(event: AlchemyWebhookEvent): void {
  formatEvent(event);
}
