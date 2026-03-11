import type { Config, MonitorTarget, WebhookGroup } from "./config.js";
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

/** 从 event 中取第一个交易 hash（transactions[0]、logs[0].transaction 或 traces 的 transaction） */
function getTxHash(event: AlchemyWebhookEvent): string | null {
  const block = event?.event?.data?.block;
  const tx = block?.transactions?.[0] as { hash?: string } | undefined;
  if (tx?.hash) return (tx.hash ?? "").replace(/[^a-fA-F0-9x]/g, "") || null;
  const log = block?.logs?.[0] as { transaction?: { hash?: string } } | undefined;
  if (log?.transaction?.hash) return (log.transaction.hash ?? "").replace(/[^a-fA-F0-9x]/g, "") || null;
  const tr = block?.callTracerTraces?.[0] as { transaction?: { hash?: string }; transactionHash?: string } | undefined;
  if (tr?.transaction?.hash) return (tr.transaction.hash ?? "").replace(/[^a-fA-F0-9x]/g, "") || null;
  if (tr?.transactionHash) return (tr.transactionHash ?? "").replace(/[^a-fA-F0-9x]/g, "") || null;
  return null;
}

/** 构建 TG 通知：使用命中条目的 label、network、txHash 区分是 config 里哪条规则 */
function buildTelegramMessage(
  network: string,
  txHash: string | null,
  label: string,
  kind?: "log" | "tx" | "internal_call"
): string {
  const base = getExplorerBase(network);
  const kindLine = kind ? `类型: ${kind}\n` : "";
  const parts: string[] = [
    `🔔 <b>${escapeHtml(label)}</b>`,
    kindLine,
    `网络: ${escapeHtml(network)}`,
  ].filter(Boolean);
  if (txHash) {
    parts.push(`交易: <a href="${base}/tx/${txHash}">${escapeHtml(txHash.slice(0, 10))}...${txHash.slice(-8)}</a>`);
  } else {
    parts.push("交易: —");
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

function addrEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function inList(addr: string | undefined, list: string[] | undefined): boolean {
  if (!addr || !list?.length) return !list?.length; // 空 list 表示“任意”
  return list.some((x) => addrEq(addr, x));
}

/** 区分规则：log 对应 config 里哪个 events 条目（地址 + topic 匹配），返回命中的 target，用其 label 报警 */
function matchLogToTargets(
  log: { account?: { address?: string }; topics?: string[] },
  eventTargets: MonitorTarget[]
): MonitorTarget[] {
  const logAddr = log.account?.address;
  const topics = log.topics ?? [];
  return eventTargets.filter((t) => {
    if (!inList(logAddr, t.addresses)) return false;
    if (t.topics?.length && !t.topics.some((top) => topics[0] === top)) return false;
    return true;
  });
}

/** 区分规则：tx 对应 config 里哪个 transactions 条目（from/to 匹配），返回命中的 target，用其 label 报警 */
function matchTxToTargets(
  tx: { from?: { address?: string }; to?: { address?: string } },
  txTargets: MonitorTarget[]
): MonitorTarget[] {
  const fromAddr = tx.from?.address;
  const toAddr = tx.to?.address;
  return txTargets.filter((t) => {
    const fromOk = inList(fromAddr, t.txFrom ?? t.addresses);
    const toOk = inList(toAddr, t.txTo ?? t.addresses);
    return fromOk && toOk;
  });
}

/** 区分规则：internal call（method 命中）对应 config 里哪个 internal_calls 条目（from/to/methodSelectors），返回命中的 target，用其 label 报警 */
function matchTraceToTargets(
  trace: { from?: { address?: string }; to?: { address?: string }; input?: string },
  internalTargets: MonitorTarget[]
): MonitorTarget[] {
  const fromAddr = trace.from?.address;
  const toAddr = trace.to?.address;
  const input = (trace.input ?? "").toLowerCase();
  return internalTargets.filter((t) => {
    const fromOk = inList(fromAddr, t.fromAddresses);
    const toOk = inList(toAddr, t.toAddresses ?? t.addresses);
    const selectors = getTargetMethodSelectors(t);
    const selectorOk = selectors.length === 0 || selectors.some((sel) => input.startsWith(sel));
    return fromOk && toOk && selectorOk;
  });
}

/** 从 log / tx / trace 取交易 hash */
function getTxHashFromItem(
  item: { transaction?: { hash?: string }; hash?: string },
  blockTx0?: { hash?: string }
): string | null {
  const h = item.transaction?.hash ?? item.hash ?? blockTx0?.hash;
  if (!h || typeof h !== "string") return null;
  const out = (h as string).replace(/[^a-fA-F0-9x]/g, "");
  return out || null;
}

/** 按规则匹配：每条 log/tx/trace 与给定 target 列表匹配，命中则用该条目的 label 报警；targetsOverride 为空则用 config.targets（多组时传入该组 targets） */
function alertByTargetMatch(
  config: Config,
  block: NonNullable<AlchemyWebhookEvent["event"]["data"]>["block"],
  getTxHashFallback: () => string | null,
  targetsOverride?: MonitorTarget[]
): void {
  const base = targetsOverride ?? config.targets;
  const eventTargets = base.filter((t) => t.type === "events") as MonitorTarget[];
  const txTargets = base.filter((t) => t.type === "transactions") as MonitorTarget[];
  const internalTargets = base.filter((t) => t.type === "internal_calls") as MonitorTarget[];
  const blockTx0 = block?.transactions?.[0] as { hash?: string } | undefined;

  // 有 log 时：看 log 对应 config 里哪个 events 条目，用该条目的 label
  const logs = block?.logs ?? [];
  for (const log of logs) {
    const matched = matchLogToTargets(log as { account?: { address?: string }; topics?: string[] }, eventTargets);
    const txHash = getTxHashFromItem(log as { transaction?: { hash?: string } }, blockTx0) ?? getTxHashFallback();
    for (const t of matched) {
      const label = t.label ?? "链上监控";
      const network = t.network ?? config.network;
      sendTelegram(buildTelegramMessage(network, txHash, label, "log")).catch(() => {});
    }
  }

  // 有 tx 时：看 tx 对应 config 里哪个 transactions 条目，用该条目的 label
  const txs = block?.transactions ?? [];
  for (const tx of txs) {
    const matched = matchTxToTargets(tx as { from?: { address?: string }; to?: { address?: string } }, txTargets);
    const txHash = getTxHashFromItem(tx as { hash?: string; transaction?: { hash?: string } }, blockTx0) ?? getTxHashFallback();
    for (const t of matched) {
      const label = t.label ?? "链上监控";
      const network = t.network ?? config.network;
      sendTelegram(buildTelegramMessage(network, txHash, label, "tx")).catch(() => {});
    }
  }

  // method 命中（internal call）时：看 trace 对应 config 里哪个 internal_calls 条目，用该条目的 label
  const traces = block?.callTracerTraces ?? [];
  for (const trace of traces) {
    const matched = matchTraceToTargets(
      trace as { from?: { address?: string }; to?: { address?: string }; input?: string },
      internalTargets
    );
    const txHash = getTxHashFromItem(trace as { transaction?: { hash?: string }; transactionHash?: string }, blockTx0) ?? getTxHashFallback();
    for (const t of matched) {
      const label = t.label ?? "链上监控";
      const network = t.network ?? config.network;
      sendTelegram(buildTelegramMessage(network, txHash, label, "internal_call")).catch(() => {});
    }
  }
}

/**
 * 创建事件处理器：根据 matchedTarget / matchedGroup 区分；多组时先按 signing_key 分流，再在组内按规则匹配报警
 */
export function createEventHandler(
  config: Config
): (event: AlchemyWebhookEvent, matchedTarget?: MonitorTarget, matchedGroup?: WebhookGroup) => void {
  const methodSelectors = getMethodSelectors(config);

  return function eventHandler(
    event: AlchemyWebhookEvent,
    matchedTarget?: MonitorTarget,
    matchedGroup?: WebhookGroup
  ): void {
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
      if (shouldAlert) {
        const txHash = getTxHash(event);
        const label = matchedTarget.label ?? "链上监控";
        sendTelegram(buildTelegramMessage(network, txHash, label)).catch(() => {});
      }
    } else if (matchedGroup?.targets?.length) {
      // 多组模式：已按 signing_key 分流到该组，只在该组内按规则匹配报警
      alertByTargetMatch(config, block, () => getTxHash(event), matchedGroup.targets);
    } else {
      // 单 Webhook 模式或仅用 env key 校验：将 payload 与 config.targets 做多维匹配，按 target 分别报警
      if (block && config.targets.length > 0) {
        alertByTargetMatch(config, block, () => getTxHash(event));
      }
    }
  };
}
