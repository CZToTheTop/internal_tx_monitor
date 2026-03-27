import type { Config, MonitorTarget, WebhookGroup } from "./config.js";
import type { AlchemyWebhookEvent } from "./webhook-util.js";
import { sendTelegram, getExplorerBase } from "./telegram.js";
import { getTraceToTxMapFromExplorer } from "./explorer-api.js";
import { getRpcUrl, getTraceToTxMap } from "./trace-api.js";
import {
  decodeInput,
  decodeLog,
  formatDecodedInput,
  getAbiFromExplorer,
  loadAbiFromFile,
  type DecodedInput,
} from "./abi-decoder.js";
import { runRules, type MonitorContext } from "./rules-engine.js";

function normSelector(s: unknown): string | null {
  const str = Array.isArray(s) ? s[0] : s;
  if (typeof str !== "string") return null;
  const h = str.replace(/^0x/i, "").toLowerCase().slice(0, 8);
  return "0x" + h.padEnd(8, "0");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeTxHash(h: string | null | undefined): string | null {
  if (!h || typeof h !== "string") return null;
  const hex = h.replace(/^0x/i, "").replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 64) return null;
  return "0x" + hex.toLowerCase();
}

function parseBlockNumber(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && /^0x[0-9a-fA-F]+$/.test(n)) return parseInt(n, 16);
  return null;
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

/** 从 event 中取第一个交易 hash（transactions[0]、logs[0].transaction 或 traces[0].transaction） */
function getTxHash(event: AlchemyWebhookEvent): string | null {
  const block = event?.event?.data?.block;
  const tx = block?.transactions?.[0] as string | { hash?: string } | undefined;
  if (typeof tx === "string") return normalizeTxHash(tx);
  if (tx && typeof tx === "object" && "hash" in tx && tx.hash) return normalizeTxHash(tx.hash);
  const log = block?.logs?.[0] as { transaction?: { hash?: string } } | undefined;
  if (log?.transaction?.hash) return normalizeTxHash(log.transaction.hash);
  const tr = block?.callTracerTraces?.[0] as { transaction?: { hash?: string }; transactionHash?: string } | undefined;
  if (tr?.transaction?.hash) return normalizeTxHash(tr.transaction.hash);
  if (tr?.transactionHash) return normalizeTxHash(tr.transactionHash);
  return null;
}

/** 构建 TG 通知（英文）：label、network、tx hash 与 explorer 链接；internal_call 可带 input 或 decoded params */
function buildTelegramMessage(
  network: string,
  txHash: string | null,
  label: string,
  kind?: "log" | "tx" | "internal_call",
  input?: string,
  decodedInput?: DecodedInput | null,
  ruleInfo?: string
): string {
  const base = getExplorerBase(network);
  const kindLine = kind ? `Type: ${kind}\n` : "";
  const parts: string[] = [
    `🔔 <b>${escapeHtml(label)}</b>`,
    kindLine,
    `Network: ${escapeHtml(network)}`,
  ].filter(Boolean);
  if (txHash) {
    const link = `${base}/tx/${txHash}`;
    const short = txHash.slice(0, 10) + "..." + txHash.slice(-8);
    parts.push(`Tx: <a href="${link}">${escapeHtml(short)}</a>`);
  } else {
    parts.push("Tx: —");
  }
  if (decodedInput) {
    parts.push(`Input: <code>${escapeHtml(formatDecodedInput(decodedInput))}</code>`);
  } else if (input && input !== "0x") {
    parts.push(`Input: <code>${escapeHtml(input)}</code>`);
  }
  if (ruleInfo) {
    parts.push(`Rule: <code>${escapeHtml(ruleInfo)}</code>`);
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

function addrEq(a: string | undefined, b: unknown): boolean {
  if (!a || typeof b !== "string") return false;
  return a.toLowerCase() === b.toLowerCase();
}

function inList(addr: string | undefined, list: unknown[] | undefined): boolean {
  if (!addr || !list?.length) return !list?.length; // 空 list 表示“任意”
  return list.some((x) => typeof x === "string" && addrEq(addr, x));
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

/** 从 log / tx / trace 取交易 hash（规范化 0x+64 hex） */
function getTxHashFromItem(
  item: { transaction?: { hash?: string }; hash?: string },
  blockTx0?: { hash?: string }
): string | null {
  const h = item.transaction?.hash ?? item.hash ?? blockTx0?.hash;
  return normalizeTxHash(h);
}

/** 构造规则引擎上下文的基础信息 */
function buildBaseContext(
  kind: MonitorContext["kind"],
  network: string,
  block: NonNullable<AlchemyWebhookEvent["event"]["data"]>["block"],
  target: MonitorTarget,
  txHash: string | null
): Pick<MonitorContext, "kind" | "network" | "blockNumber" | "txHash" | "target"> {
  const blockNumber = parseBlockNumber(block?.number);
  return {
    kind,
    network,
    blockNumber: blockNumber ?? undefined,
    txHash,
    target,
  };
}

/** 按规则匹配：每条 log/tx/trace 与给定 target 列表匹配，命中则用该条目的 label 报警；targetsOverride 为空则用 config.targets（多组时传入该组 targets） */
async function alertByTargetMatch(
  config: Config,
  block: NonNullable<AlchemyWebhookEvent["event"]["data"]>["block"],
  getTxHashFallback: () => string | null,
  targetsOverride?: MonitorTarget[]
): Promise<void> {
  const base = targetsOverride ?? config.targets;
  const eventTargets = base.filter((t) => t.type === "events") as MonitorTarget[];
  const txTargets = base.filter((t) => t.type === "transactions") as MonitorTarget[];
  const internalTargets = base.filter((t) => t.type === "internal_calls") as MonitorTarget[];
  const tx0 = block?.transactions?.[0];
  const blockTx0 = typeof tx0 === "string" ? { hash: tx0 } : (tx0 as { hash?: string } | undefined);

  // 有 log 时：看 log 对应 config 里哪个 events 条目，用该条目的 label
  const logs = block?.logs ?? [];
  for (const log of logs) {
    const matched = matchLogToTargets(log as { account?: { address?: string }; topics?: string[] }, eventTargets);
    const txHash = getTxHashFromItem(log as { transaction?: { hash?: string } }, blockTx0) ?? getTxHashFallback();
    const logObj = log as {
      account?: { address?: string };
      topics?: string[];
      data?: string;
      transaction?: { hash?: string; from?: { address?: string } };
    };
    for (const t of matched) {
      const label = t.label ?? "Monitor";
      const network = t.network ?? config.network;
      if (!t.rules?.length) {
        // 兼容旧行为：未配置 rules 时，命中即报警
        sendTelegram(buildTelegramMessage(network, txHash, label, "log")).catch(() => {});
        continue;
      }

      let ctx: MonitorContext = {
        ...buildBaseContext("log", network, block, t, txHash),
        log,
        caller: logObj.transaction?.from?.address,
      };
      const topics = logObj.topics ?? [];
      if (topics.length > 0) {
        const addr = logObj.account?.address;
        const abi = t.abi?.length ? t.abi : t.abiPath ? loadAbiFromFile(t.abiPath) : null;
        const abiResolved = abi ?? (addr ? await getAbiFromExplorer(addr, network) : null);
        if (abiResolved?.length) {
          const decodedEv = decodeLog(abiResolved, topics, logObj.data ?? "0x");
          if (decodedEv) {
            ctx = { ...ctx, args: decodedEv.args, eventName: decodedEv.name, eventSignature: decodedEv.name };
          }
        }
        if (!ctx.caller && txHash && Array.isArray(block?.transactions)) {
          const txWithFrom = block.transactions.find(
            (x) => (typeof x === "object" && (x as { hash?: string }).hash === txHash) || x === txHash
          ) as { from?: { address?: string } } | undefined;
          if (txWithFrom?.from?.address) ctx = { ...ctx, caller: txWithFrom.from.address };
        }
      }
      const ruleResults = await runRules(ctx, t.rules);
      if (ruleResults.length > 0) {
        const first = ruleResults[0]!;
        const ruleInfo =
          (first.rule.name ?? "rule") + (first.reason ? `: ${first.reason}` : "");
        sendTelegram(buildTelegramMessage(network, txHash, label, "log", undefined, undefined, ruleInfo)).catch(
          () => {}
        );
      }
    }
  }

  // 有 tx 时：看 tx 对应 config 里哪个 transactions 条目，用该条目的 label
  const txs = block?.transactions ?? [];
  for (const tx of txs) {
    const matched = matchTxToTargets(tx as { from?: { address?: string }; to?: { address?: string } }, txTargets);
    const txHash = getTxHashFromItem(tx as { hash?: string; transaction?: { hash?: string } }, blockTx0) ?? getTxHashFallback();
    for (const t of matched) {
      const label = t.label ?? "Monitor";
      const network = t.network ?? config.network;
      if (!t.rules?.length) {
        sendTelegram(buildTelegramMessage(network, txHash, label, "tx")).catch(() => {});
        continue;
      }

      const txObj = tx as { from?: { address?: string } };
      const ctx: MonitorContext = {
        ...buildBaseContext("tx", network, block, t, txHash),
        tx,
        caller: txObj?.from?.address,
      };
      const ruleResults = await runRules(ctx, t.rules);
      if (ruleResults.length > 0) {
        const first = ruleResults[0]!;
        const ruleInfo =
          (first.rule.name ?? "rule") + (first.reason ? `: ${first.reason}` : "");
        sendTelegram(buildTelegramMessage(network, txHash, label, "tx", undefined, undefined, ruleInfo)).catch(
          () => {}
        );
      }
    }
  }

  // method 命中（internal call）时：看 trace 对应 config 里哪个 internal_calls 条目，用该条目的 label
  // parent tx 获取顺序：1) trace.transaction 2) Explorer API 3) RPC debug_trace 4) 单 tx 区块启发式 5) fallback
  const traces = block?.callTracerTraces ?? [];
  let traceToTxMap = new Map<number, string>();
  const blockNum = parseBlockNumber(block?.number);
  const tracePayload = traces as Array<{ from?: { address?: string }; to?: { address?: string }; input?: string }>;

  if (traces.length > 0 && blockNum != null) {
    traceToTxMap = await getTraceToTxMapFromExplorer(config.network, blockNum, tracePayload);
    if (traceToTxMap.size < traces.length) {
      const rpcUrl = getRpcUrl(config.network);
      if (rpcUrl) {
        try {
          const rpcMap = await getTraceToTxMap(rpcUrl, blockNum, tracePayload);
          for (const [k, v] of rpcMap) {
            if (!traceToTxMap.has(k)) traceToTxMap.set(k, v);
          }
        } catch {
          // 忽略 RPC 失败
        }
      }
    }
  }
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i]!;
    const matched = matchTraceToTargets(
      trace as { from?: { address?: string }; to?: { address?: string }; input?: string },
      internalTargets
    );
    const txHash =
      traceToTxMap.get(i) ??
      getTxHashFromItem(trace as { transaction?: { hash?: string }; transactionHash?: string }, blockTx0);
    const inp = (trace as { input?: string }).input ?? "";
    const toAddr = (trace as { to?: { address?: string } }).to?.address;
    for (const t of matched) {
      const label = t.label ?? "Monitor";
      const network = t.network ?? config.network;
      let decoded: DecodedInput | null = null;
      const abi =
        t.abi?.length ? t.abi : t.abiPath ? loadAbiFromFile(t.abiPath) : null;
      const abiResolved = abi ?? (toAddr ? await getAbiFromExplorer(toAddr, network) : null);
      if (abiResolved?.length && inp) decoded = decodeInput(abiResolved, inp);

      if (!t.rules?.length) {
        // 未配置 rules：保持原有简单报警行为
        sendTelegram(
          buildTelegramMessage(network, txHash, label, "internal_call", inp, decoded)
        ).catch(() => {});
        continue;
      }

      const argsArray = decoded ? Object.values(decoded.args ?? {}) : [];
      const traceObj = trace as { from?: { address?: string } };
      const ctx: MonitorContext = {
        ...buildBaseContext("internal_call", network, block, t, txHash),
        trace,
        args: argsArray,
        functionName: decoded?.name,
        functionSignature: decoded?.name,
        caller: traceObj?.from?.address,
      };
      const ruleResults = await runRules(ctx, t.rules);
      if (ruleResults.length > 0) {
        const first = ruleResults[0]!;
        const ruleInfo =
          (first.rule.name ?? "rule") + (first.reason ? `: ${first.reason}` : "");
        sendTelegram(
          buildTelegramMessage(network, txHash, label, "internal_call", inp, decoded, ruleInfo)
        ).catch(() => {});
      }
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

  return async function eventHandler(
    event: AlchemyWebhookEvent,
    matchedTarget?: MonitorTarget,
    matchedGroup?: WebhookGroup
  ): Promise<void> {
    const block = event?.event?.data?.block;
    let traces = block?.callTracerTraces;
    const targetSelectors = matchedTarget ? getTargetMethodSelectors(matchedTarget) : methodSelectors;

    if (traces?.length && targetSelectors.length) {
      traces = traces.filter((t) => {
        const inp = ((t as { input?: string }).input ?? "").toLowerCase();
        return targetSelectors.some((sel) => inp.startsWith(sel));
      });
    }

    formatEvent(event, traces);

    if (matchedTarget) {
      // 单 target + signing_key 模式：按该 target 的规则匹配（含 rules 引擎）
      if (block) {
        await alertByTargetMatch(config, block, () => getTxHash(event), [matchedTarget]);
      }
    } else if (matchedGroup?.targets?.length) {
      // 多组模式：已按 signing_key 分流到该组，只在该组内按规则匹配报警
      if (block) {
        await alertByTargetMatch(config, block, () => getTxHash(event), matchedGroup.targets);
      }
    } else {
      // 单 Webhook 模式或仅用 env key 校验：将 payload 与 config.targets 做多维匹配，按 target 分别报警
      if (block && config.targets.length > 0) {
        await alertByTargetMatch(config, block, () => getTxHash(event));
      }
    }
  };
}
