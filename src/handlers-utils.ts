/**
 * 纯函数工具，供 handlers 使用并便于单元测试
 */
import type { MonitorTarget } from "./config.js";

/** 规范化 method selector 为 0x + 8 位小写 hex */
export function normSelector(s: unknown): string | null {
  const str = Array.isArray(s) ? s[0] : s;
  if (typeof str !== "string") return null;
  const h = str.replace(/^0x/i, "").toLowerCase().slice(0, 8);
  return "0x" + h.padEnd(8, "0");
}

/** 转义 HTML 特殊字符 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 规范化 hash 为 0x + 64 位 hex */
export function normalizeTxHash(h: string | null | undefined): string | null {
  if (!h || typeof h !== "string") return null;
  const hex = h.replace(/^0x/i, "").replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 64) return null;
  return "0x" + hex.toLowerCase();
}

export function addrEq(a: string | undefined, b: unknown): boolean {
  if (!a || typeof b !== "string") return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function inList(addr: string | undefined, list: unknown[] | undefined): boolean {
  if (!addr || !list?.length) return !list?.length;
  return list.some((x) => typeof x === "string" && addrEq(addr, x));
}

/** 从 target 收集 methodSelectors（仅 internal_calls） */
export function getTargetMethodSelectors(target: { type: string; methodSelectors?: unknown[] }): string[] {
  const set = new Set<string>();
  if (target.type !== "internal_calls" || !target.methodSelectors?.length) return [];
  for (const s of target.methodSelectors) {
    const n = normSelector(s);
    if (n) set.add(n);
  }
  return [...set];
}

export function matchLogToTargets(
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

export function matchTxToTargets(
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

export function matchTraceToTargets(
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

export function parseBlockNumber(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && /^0x[0-9a-fA-F]+$/.test(n)) return parseInt(n, 16);
  return null;
}
