import type { Config, MonitorTarget } from "./config.js";
import type { AlchemyWebhookEvent } from "./webhook-util.js";
import { sendTelegram, getExplorerBase } from "./telegram.js";

/** 规范化 method selector 为 0x + 8 位小写 hex */
function normSelector(s: unknown): string | null {
  const str = Array.isArray(s) ? s[0] : s;
  if (typeof str !== "string") return null;
  const h = str.replace(/^0x/i, "").toLowerCase().slice(0, 8);
  return "0x" + h.padEnd(8, "0");
}

/** 从 config 收集所有 internal_calls 的 methodSelectors */
function getMethodSelectors(config: Config): string[] {
  const set = new Set<string>();
  for (const t of config.targets) {
    if (t.type === "internal_calls" && t.methodSelectors?.length) {
      for (const s of t.methodSelectors) {
        const n = normSelector(s);
        if (n) set.add(n);
      }
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

/** 转义 HTML 特殊字符，防止注入 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const blockNum = String(block?.number ?? "-");
  const blockHash = (block?.hash ?? "").replace(/[^a-fA-F0-9x]/g, "");
  const base = getExplorerBase(network);
  const blockUrl = blockHash ? `${base}/block/${blockHash}` : `${base}/block/${blockNum}`;

  const parts: string[] = [
    `🔔 <b>链上监控</b>`,
    `网络: ${escapeHtml(network)}`,
    `区块: <a href="${blockUrl}">#${escapeHtml(blockNum)}</a>`,
    `logs: ${logs} | txs: ${txs} | traces: ${traces}`,
  ];

  const tx = block?.transactions?.[0] as { hash?: string } | undefined;
  if (tx?.hash) {
    const h = (tx.hash ?? "").replace(/[^a-fA-F0-9x]/g, "");
    if (h) parts.push(`交易: <a href="${base}/tx/${h}">${escapeHtml(h.slice(0, 18))}...</a>`);
  }

  const log = block?.logs?.[0] as { transaction?: { hash?: string } } | undefined;
  if (log?.transaction?.hash) {
    const h = (log.transaction.hash ?? "").replace(/[^a-fA-F0-9x]/g, "");
    if (h) parts.push(`Log: <a href="${base}/tx/${h}">查看</a>`);
  }

  const tr = tracesData?.[0] as { from?: { address?: string }; to?: { address?: string }; input?: string } | undefined;
  if (tr) {
    const fromAddr = (tr.from?.address ?? "").slice(0, 10);
    const toAddr = (tr.to?.address ?? "").slice(0, 10);
    parts.push(`内部调用: ${escapeHtml(fromAddr)}... → ${escapeHtml(toAddr)}...`);
    if (tr.input) parts.push(`input: ${escapeHtml(tr.input.slice(0, 20))}...`);
  }

  return parts.join("\n");
}

/** 从单个 target 收集 methodSelectors（仅 internal_calls） */
function getTargetMethodSelectors(target: { type: string; methodSelectors?: unknown[] }): string[] {
  const set = new Set<string>();
  if (target.type !== "internal_calls" || !target.methodSelectors?.length) return [];
  for (const s of target.methodSelectors) {
    const n = normSelector(s);
    if (n) set.add(n);
  }
  return [...set];
}

/**
 * 创建事件处理器：根据 matchedTarget 区分监控类型，仅对对应数据（log/tx/traces）报警
 */
export function createEventHandler(config: Config): (event: AlchemyWebhookEvent, matchedTarget?: MonitorTarget) => void {
  const methodSelectors = getMethodSelectors(config);

  return function eventHandler(event: AlchemyWebhookEvent, matchedTarget?: MonitorTarget): void {
    const block = event?.event?.data?.block;
    let traces = block?.callTracerTraces;
    const targetSelectors = matchedTarget ? getTargetMethodSelectors(matchedTarget) : methodSelectors;

    if (traces?.length && targetSelectors.length) {
      traces = traces.filter((t) => {
        const inp = ((t as { input?: string }).input ?? "").toLowerCase();
        return targetSelectors.some((sel) => inp.startsWith(sel));
      });
    }

    const logs = block?.logs?.length ?? 0;
    const txs = block?.transactions?.length ?? 0;
    const traceCount = traces?.length ?? block?.callTracerTraces?.length ?? 0;

    formatEvent(event, traces);

    const network = matchedTarget?.network ?? config.network;
    let shouldAlert: boolean;
    if (matchedTarget) {
      if (matchedTarget.type === "events") shouldAlert = logs > 0;
      else if (matchedTarget.type === "transactions") shouldAlert = txs > 0;
      else shouldAlert = traceCount > 0; // internal_calls
    } else {
      const isInternalCallsPayload = (block?.callTracerTraces?.length ?? 0) > 0;
      shouldAlert = isInternalCallsPayload ? traceCount > 0 : (logs > 0 || txs > 0);
    }

    if (shouldAlert) {
      const msg = buildTelegramMessage(
        event,
        logs,
        txs,
        traceCount,
        network,
        traces as unknown[] | undefined
      );
      sendTelegram(msg).catch(() => {});
    }
  };
}
