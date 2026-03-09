import type { AlchemyWebhookEvent } from "./webhook-util.js";

function formatEvent(event: AlchemyWebhookEvent): void {
  const { id, webhookId, type, event: ev } = event;
  const block = ev?.data?.block;
  const logs = block?.logs?.length ?? 0;
  const txs = block?.transactions?.length ?? 0;
  const traces = block?.callTracerTraces?.length ?? 0;

  console.log(
    `[webhook] id=${id} webhookId=${webhookId} type=${type} ` +
      `block=${block?.number ?? "-"} logs=${logs} txs=${txs} traces=${traces}`
  );
  if (block?.hash) console.log(`[webhook] blockHash=${block.hash}`);
  const truncate = (s: string, max = 500) =>
    s.length > max ? s.slice(0, max) + "..." : s;
  if (logs > 0) console.log("[webhook] logs:", truncate(JSON.stringify(block?.logs)));
  if (txs > 0) console.log("[webhook] txs:", truncate(JSON.stringify(block?.transactions)));
  if (traces > 0) console.log("[webhook] traces:", truncate(JSON.stringify(block?.callTracerTraces)));
}

/**
 * 默认事件处理器：格式化输出到控制台
 * 可替换为写入数据库、发送告警等
 */
export function defaultEventHandler(event: AlchemyWebhookEvent): void {
  formatEvent(event);
}
