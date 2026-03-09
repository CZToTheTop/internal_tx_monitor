import type { Config } from "./config.js";
import type { AlchemyWebhookEvent } from "./webhook-util.js";
import { sendTelegram, getExplorerBase } from "./telegram.js";

/** 规范化 method selector 为 0x + 8 位小写 hex */
function normSelector(s: string): string {
  const h = s.replace(/^0x/i, "").toLowerCase().slice(0, 8);
  return "0x" + h.padEnd(8, "0");
}

/** 从 config 收集所有 internal_calls 的 methodSelectors */
function getMethodSelectors(config: Config): string[] {
  const set = new Set<string>();
  for (const t of config.targets) {
    if (t.type === "internal_calls" && t.methodSelectors?.length) {
      for (const s of t.methodSelectors) set.add(normSelector(s));
    }
  }
  return [...set];
}

function formatEvent(event: AlchemyWebhookEvent, traces?: unknown[]): void {
  const { id, webhookId, type, event: ev } = event;
  const block = ev?.data?.block;
  const logs = block?.logs?.length ?? 0;
  const txs = block?.transactions?.length ?? 0;
  const traceCount = traces?.length ?? block?.callTracerTraces?.length ?? 0;

  console.log(
    `[webhook] id=${id} webhookId=${webhookId} type=${type} ` +
      `block=${block?.number ?? "-"} logs=${logs} txs=${txs} traces=${traceCount}`
  );
  if (block?.hash) console.log(`[webhook] blockHash=${block.hash}`);
  const truncate = (s: string, max = 500) =>
    s.length > max ? s.slice(0, max) + "..." : s;
  if (logs > 0) console.log("[webhook] logs:", truncate(JSON.stringify(block?.logs)));
  if (txs > 0) console.log("[webhook] txs:", truncate(JSON.stringify(block?.transactions)));
  if (traceCount > 0) console.log("[webhook] traces:", truncate(JSON.stringify(traces ?? block?.callTracerTraces)));
}

/** 构建 TG 通知文本 */
function buildTelegramMessage(
  event: AlchemyWebhookEvent,
  logs: number,
  txs: number,
  traces: number,
  network: string,
  tracesData?: unknown[]
): string {
  const block = event?.event?.data?.block;
  const blockNum = block?.number ?? "-";
  const blockHash = block?.hash ?? "";
  const base = getExplorerBase(network);
  const blockUrl = blockHash ? `${base}/block/${blockHash}` : `${base}/block/${blockNum}`;

  const parts: string[] = [
    `🔔 <b>链上监控</b>`,
    `网络: ${network}`,
    `区块: <a href="${blockUrl}">#${blockNum}</a>`,
    `logs: ${logs} | txs: ${txs} | traces: ${traces}`,
  ];

  const tx = block?.transactions?.[0] as { hash?: string } | undefined;
  if (tx?.hash) parts.push(`交易: <a href="${base}/tx/${tx.hash}">${tx.hash.slice(0, 18)}...</a>`);

  const log = block?.logs?.[0] as { transaction?: { hash?: string } } | undefined;
  if (log?.transaction?.hash) parts.push(`Log: <a href="${base}/tx/${log.transaction.hash}">查看</a>`);

  const tr = tracesData?.[0] as { from?: { address?: string }; to?: { address?: string }; input?: string } | undefined;
  if (tr) {
    parts.push(`内部调用: ${tr.from?.address?.slice(0, 10)}... → ${tr.to?.address?.slice(0, 10)}...`);
    if (tr.input) parts.push(`input: ${tr.input.slice(0, 20)}...`);
  }

  return parts.join("\n");
}

/**
 * 创建事件处理器，支持按 method selector 过滤 internal call traces，并发送 TG 通知
 */
export function createEventHandler(config: Config): (event: AlchemyWebhookEvent) => void {
  const methodSelectors = getMethodSelectors(config);

  return function eventHandler(event: AlchemyWebhookEvent): void {
    const block = event?.event?.data?.block;
    let traces = block?.callTracerTraces;

    if (traces?.length && methodSelectors.length) {
      traces = traces.filter((t) => {
        const inp = ((t as { input?: string }).input ?? "").toLowerCase();
        return methodSelectors.some((sel) => inp.startsWith(sel));
      });
    }

    const logs = block?.logs?.length ?? 0;
    const txs = block?.transactions?.length ?? 0;
    const traceCount = traces?.length ?? block?.callTracerTraces?.length ?? 0;

    formatEvent(event, traces);

    if (logs > 0 || txs > 0 || traceCount > 0) {
      const msg = buildTelegramMessage(
        event,
        logs,
        txs,
        traceCount,
        config.network,
        traces as unknown[] | undefined
      );
      sendTelegram(msg).catch(() => {});
    }
  };
}
