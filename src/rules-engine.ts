import type { MonitorTarget, RuleConfig, RuleCheck } from "./config.js";
import { getRpcUrl } from "./trace-api.js";
import {
  JsonRpcProvider,
  Contract,
  Interface,
  type FunctionFragment,
  getAddress,
} from "ethers";
import { getCustomRuleHandler } from "./custom-rules.js";

export type MonitorKind = "log" | "tx" | "internal_call";

/** 规则执行时可用的上下文信息 */
export interface MonitorContext {
  kind: MonitorKind;
  network: string;
  blockNumber?: number;
  txHash?: string | null;
  /** 命中的顶层监控 target */
  target: MonitorTarget;
  /** 原始链上对象，类型保持宽松以兼容不同来源 */
  log?: unknown;
  tx?: unknown;
  trace?: unknown;
  /**
   * 已解码的参数列表（函数或事件），按照 ABI 顺序；
   * 由调用方在 decode 后填充
   */
  args?: unknown[];
  /** 函数名称（不含参数） */
  functionName?: string;
  /** 函数完整签名，如 revokeRole(bytes32,address) */
  functionSignature?: string;
  /** 事件名称（不含参数） */
  eventName?: string;
  /** 事件完整签名，如 Transfer(address,address,uint256) */
  eventSignature?: string;
  /** 调用者地址（tx.from 或 trace.from），用于 callerNotIn 等规则 */
  caller?: string;
}

/** 状态访问接口，便于在测试中注入 mock 实现 */
export interface StateClient {
  getNativeBalance(address: string): Promise<bigint>;
  getTokenBalance(token: string, address: string): Promise<bigint>;
  getStorage(address: string, slot: string): Promise<string>;
  /**
   * 链上 view/pure 调用；用于 callerNotIn.allowedFromCall。
   * 未实现时若配置了 allowedFromCall 会跳过动态列表并打警告。
   */
  callView?(contract: string, signature: string, args?: unknown[]): Promise<unknown>;
}

export interface RuleResult {
  rule: RuleConfig;
  matched: boolean;
  /** 规则命中的简短说明 */
  reason?: string;
}

const stateClientCache = new Map<string, StateClient>();

function getDefaultStateClient(network: string): StateClient {
  const cached = stateClientCache.get(network);
  if (cached) return cached;

  const rpcUrl = getRpcUrl(network);
  if (!rpcUrl) {
    throw new Error(`rules-engine: 未配置 ${network} 的 RPC，无法执行状态检查`);
  }
  const provider = new JsonRpcProvider(rpcUrl);

  const client: StateClient = {
    async getNativeBalance(address: string): Promise<bigint> {
      return provider.getBalance(address);
    },
    async getTokenBalance(token: string, address: string): Promise<bigint> {
      const erc20 = new Contract(
        token,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const value = await erc20.balanceOf(address);
      // ethers v6 BigInt 兼容
      return BigInt(value.toString());
    },
    async getStorage(address: string, slot: string): Promise<string> {
      // JsonRpcProvider 在 ethers v6 中支持 getStorage
      const raw = await (provider as any).getStorage(address, slot);
      return typeof raw === "string" ? raw : String(raw ?? "");
    },
    async callView(
      contract: string,
      signature: string,
      args: unknown[] = []
    ): Promise<unknown> {
      const iface = new Interface([signature]);
      const frag = iface.fragments.find(
        (f): f is FunctionFragment => f.type === "function"
      );
      if (!frag) {
        throw new Error("rules-engine: callView signature 需为有效 function");
      }
      const c = new Contract(contract, iface, provider);
      const fn = c.getFunction(frag.name);
      return await fn.staticCall(...args);
    },
  };

  stateClientCache.set(network, client);
  return client;
}

function normalizeAddress(addr: string | undefined | null): string | null {
  if (!addr || typeof addr !== "string") return null;
  const hex = addr.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(hex) ? hex : null;
}

function toBigInt(value: string | number): bigint {
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const v = value.trim();
  if (v.startsWith("0x") || v.startsWith("0X")) {
    return BigInt(v);
  }
  return BigInt(v);
}

/** 忽略 `function ` 前缀与空白，便于 YAML 与 ethers fragment.format('full') 互认 */
function normalizeFunctionSigForCompare(s: string): string {
  return s
    .trim()
    .replace(/^function\s+/i, "")
    .replace(/\s+/g, "");
}

function functionMatches(ctx: MonitorContext, sig?: string): boolean {
  if (!sig) return true;
  const expect = sig.trim();
  const name = ctx.functionName ?? "";
  const fs = ctx.functionSignature ?? "";
  if (fs === expect || name === expect) return true;
  if (fs && normalizeFunctionSigForCompare(fs) === normalizeFunctionSigForCompare(expect)) {
    return true;
  }
  const bare = expect.includes("(") ? expect.split("(")[0]!.trim() : expect;
  if (bare && name.toLowerCase() === bare.toLowerCase()) return true;
  return false;
}

function eventMatches(ctx: MonitorContext, sig?: string): boolean {
  if (!sig) return true;
  const expect = sig.trim();
  return (
    ctx.eventSignature === expect ||
    ctx.eventName === expect
  );
}

function whenMatches(ctx: MonitorContext, rule: RuleConfig): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.functions?.length) {
    if (!w.functions.some((sig) => functionMatches(ctx, sig))) return false;
  } else if (w.function && !functionMatches(ctx, w.function)) {
    return false;
  }
  if (w.event && !eventMatches(ctx, w.event)) return false;
  return true;
}

async function evalParamIn(
  ctx: MonitorContext,
  check: Extract<RuleCheck, { type: "paramIn" }>
): Promise<{ matched: boolean; reason?: string }> {
  const args = ctx.args ?? [];
  const value = args[check.argIndex];
  if (value === undefined) {
    return { matched: false };
  }
  const allowed = check.allowed ?? [];
  const hit = allowed.some((v) => {
    // 简单宽松比较：字符串直接比较；数字与 BigInt 则按字符串比较
    if (typeof v === "string" || typeof value === "string") {
      return String(v) === String(value);
    }
    try {
      return toBigInt(v as any) === toBigInt(value as any);
    } catch {
      return false;
    }
  });
  if (hit) return { matched: false };
  return {
    matched: true,
    reason: `参数[${check.argIndex}]=${String(value)} 不在允许集合内`,
  };
}

async function evalBalanceInRange(
  ctx: MonitorContext,
  check: Extract<RuleCheck, { type: "balanceInRange" }>,
  state: StateClient
): Promise<{ matched: boolean; reason?: string }> {
  const targetAddr =
    normalizeAddress(check.address ?? undefined) ??
    normalizeAddress(
      check.addressRef === "target" ? ctx.target.addresses?.[0] : null
    );

  if (!targetAddr) {
    return { matched: false };
  }

  let bal: bigint;
  const token = check.token ?? "native";

  if (token === "native") {
    bal = await state.getNativeBalance(targetAddr);
  } else {
    bal = await state.getTokenBalance(token, targetAddr);
  }

  let ok = true;
  if (check.min != null) {
    ok = ok && bal >= toBigInt(check.min);
  }
  if (check.max != null) {
    ok = ok && bal <= toBigInt(check.max);
  }

  if (ok) return { matched: false };
  return {
    matched: true,
    reason: `余额 ${bal.toString()} 超出预期区间`,
  };
}

async function evalStorageSlotEquals(
  ctx: MonitorContext,
  check: Extract<RuleCheck, { type: "storageSlotEquals" }>,
  state: StateClient
): Promise<{ matched: boolean; reason?: string }> {
  const addr = normalizeAddress(ctx.target.addresses?.[0]);
  if (!addr) return { matched: false };
  const current = await state.getStorage(addr, check.slot);
  if (current.toLowerCase() === check.expected.toLowerCase()) {
    return { matched: false };
  }
  return {
    matched: true,
    reason: `storage slot ${check.slot} 当前值 ${current} 与预期 ${check.expected} 不一致`,
  };
}

function addrInList(addr: string | null | undefined, list: string[]): boolean {
  if (!addr || !list?.length) return false;
  const a = addr.toLowerCase();
  return list.some((x) => (x ?? "").toLowerCase() === a);
}

type CallerAllowedFromCallSpec = NonNullable<
  Extract<RuleCheck, { type: "callerNotIn" }>["allowedFromCall"]
>;

const allowedFromCallCache = new Map<
  string,
  { expires: number; addresses: string[] }
>();

/** bool 模式按 caller 分条缓存 */
const allowedFromCallBoolCache = new Map<
  string,
  { expires: number; whitelisted: boolean }
>();

function allowedFromCallResolvedCacheKey(
  network: string,
  spec: CallerAllowedFromCallSpec,
  argsResolved: unknown[]
): string {
  return `${network}:${spec.contract}:${spec.signature}:${JSON.stringify(argsResolved)}`;
}

/**
 * YAML args：`$caller` = trace/tx caller；`$arg0`、`$arg1`… = 当前解码后的 calldata 参数（与 MonitorContext.args 顺序一致）
 */
function substituteAllowedFromCallArgs(
  args: unknown[] | undefined,
  ctx: MonitorContext,
  caller: string
): unknown[] {
  if (!args?.length) return [];
  const checksumCaller = (() => {
    try {
      return getAddress(caller);
    } catch {
      return caller;
    }
  })();
  const decoded = ctx.args ?? [];

  return args.map((a) => {
    if (a === "$caller") return checksumCaller;
    if (typeof a === "string" && /^\$arg\d+$/.test(a)) {
      const idx = parseInt(a.slice(4), 10);
      const v = decoded[idx];
      if (v === undefined || v === null) {
        console.warn(
          `[rules-engine] allowedFromCall: ctx.args[${idx}] 缺失，无法替换 ${a}`
        );
        return v;
      }
      const s = typeof v === "bigint" ? v.toString() : String(v);
      try {
        return getAddress(s);
      } catch {
        return v;
      }
    }
    return a;
  });
}

/** 将 view 返回值解析为 checksummed 小写地址列表（支持单个 address 或 address[]） */
function extractAddressesFromCallResult(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const n = normalizeAddress(value);
    return n ? [n] : [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...extractAddressesFromCallResult(item));
    }
    return out;
  }
  if (typeof value === "object" && value !== null && Symbol.iterator in value) {
    try {
      return extractAddressesFromCallResult([
        ...(value as Iterable<unknown>),
      ]);
    } catch {
      return [];
    }
  }
  return [];
}

function staticAllowedList(check: Extract<RuleCheck, { type: "callerNotIn" }>): string[] {
  return (check.allowed ?? [])
    .map((x) => (typeof x === "string" ? x : "").toLowerCase())
    .filter(Boolean);
}

/** 仅拉取 address / address[] 白名单（不含静态 allowed） */
async function fetchDynamicAddressesForCallerNotIn(
  ctx: MonitorContext,
  spec: CallerAllowedFromCallSpec,
  caller: string,
  state: StateClient
): Promise<string[]> {
  const ttlMs =
    spec.cacheSeconds === undefined
      ? 60_000
      : Math.max(0, spec.cacheSeconds * 1000);
  const argsResolved = substituteAllowedFromCallArgs(
    spec.args,
    ctx,
    caller
  );
  const cacheKey = `list:${allowedFromCallResolvedCacheKey(ctx.network, spec, argsResolved)}`;

  if (ttlMs > 0) {
    const hit = allowedFromCallCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      return hit.addresses;
    }
  }

  if (!state.callView) {
    console.warn(
      "[rules-engine] callerNotIn.allowedFromCall 需要 StateClient.callView，已跳过动态白名单"
    );
    return [];
  }

  let dynamic: string[] = [];
  let fetchOk = false;
  try {
    const raw = await state.callView(
      spec.contract,
      spec.signature,
      argsResolved
    );
    dynamic = extractAddressesFromCallResult(raw)
      .map((x) => normalizeAddress(x))
      .filter((x): x is string => x != null);
    fetchOk = true;
  } catch (err) {
    console.warn(
      "[rules-engine] allowedFromCall 失败:",
      (err as Error)?.message ?? String(err)
    );
  }

  if (ttlMs > 0 && fetchOk) {
    allowedFromCallCache.set(cacheKey, {
      expires: Date.now() + ttlMs,
      addresses: dynamic,
    });
  }

  return dynamic;
}

/** mapping(address => bool) 等：返回 true 表示 caller 已在白名单 */
async function fetchBoolWhitelisted(
  ctx: MonitorContext,
  spec: CallerAllowedFromCallSpec,
  caller: string,
  state: StateClient
): Promise<boolean> {
  const ttlMs =
    spec.cacheSeconds === undefined
      ? 60_000
      : Math.max(0, spec.cacheSeconds * 1000);
  const argsResolved = substituteAllowedFromCallArgs(
    spec.args,
    ctx,
    caller
  );
  const key = `bool:${allowedFromCallResolvedCacheKey(ctx.network, spec, argsResolved)}`;
  if (ttlMs > 0) {
    const hit = allowedFromCallBoolCache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.whitelisted;
    }
  }

  if (!state.callView) {
    console.warn(
      "[rules-engine] callerNotIn.allowedFromCall 需要 StateClient.callView，已跳过动态白名单"
    );
    return false;
  }
  let whitelisted = false;
  let fetchOk = false;
  try {
    const raw = await state.callView(
      spec.contract,
      spec.signature,
      argsResolved
    );
    whitelisted = Boolean(raw);
    fetchOk = true;
  } catch (err) {
    console.warn(
      "[rules-engine] allowedFromCall 失败:",
      (err as Error)?.message ?? String(err)
    );
  }

  if (ttlMs > 0 && fetchOk) {
    allowedFromCallBoolCache.set(key, {
      expires: Date.now() + ttlMs,
      whitelisted,
    });
  }

  return whitelisted;
}

function argsNeedCallerPlaceholder(args: unknown[] | undefined): boolean {
  return args?.some((a) => a === "$caller") ?? false;
}

function notWhitelistedReason(
  ctx: MonitorContext,
  spec: CallerAllowedFromCallSpec | undefined,
  caller: string | null
): string {
  if (spec?.args?.some((a) => a === "$arg0")) {
    const p = ctx.args?.[0];
    return `proposer ${p != null ? String(p) : "?"} 不在白名单内`;
  }
  return `caller ${caller ?? "?"} 不在白名单内`;
}

async function evalCallerNotIn(
  ctx: MonitorContext,
  check: Extract<RuleCheck, { type: "callerNotIn" }>,
  state: StateClient
): Promise<{ matched: boolean; reason?: string }> {
  const caller = normalizeAddress(ctx.caller);
  const staticList = staticAllowedList(check);
  const spec = check.allowedFromCall;

  if (caller && addrInList(caller, staticList)) return { matched: false };

  if (argsNeedCallerPlaceholder(spec?.args) && !caller) {
    return { matched: false };
  }

  if (!spec) {
    if (!caller) return { matched: false };
    return {
      matched: true,
      reason: notWhitelistedReason(ctx, undefined, caller),
    };
  }

  const callerForSubst = caller ?? "";

  if (spec.returns === "bool") {
    const ok = await fetchBoolWhitelisted(ctx, spec, callerForSubst, state);
    if (ok) return { matched: false };
    return {
      matched: true,
      reason: notWhitelistedReason(ctx, spec, caller),
    };
  }

  if (!caller) {
    return { matched: false };
  }

  const dynamic = await fetchDynamicAddressesForCallerNotIn(
    ctx,
    spec,
    caller,
    state
  );
  if (addrInList(caller, dynamic)) return { matched: false };
  return {
    matched: true,
    reason: notWhitelistedReason(ctx, spec, caller),
  };
}

async function evalParamOutsideRange(
  ctx: MonitorContext,
  check: Extract<RuleCheck, { type: "paramOutsideRange" }>
): Promise<{ matched: boolean; reason?: string }> {
  const args = ctx.args ?? [];
  const raw = args[check.argIndex];
  if (raw == null) return { matched: false };
  let val: bigint;
  try {
    val = toBigInt(String(raw));
  } catch {
    return { matched: false };
  }
  if (check.min != null && val < toBigInt(check.min)) {
    return { matched: true, reason: `参数[${check.argIndex}]=${val} 小于 min=${check.min}` };
  }
  if (check.max != null && val > toBigInt(check.max)) {
    return { matched: true, reason: `参数[${check.argIndex}]=${val} 大于 max=${check.max}` };
  }
  return { matched: false };
}

async function evalCheck(
  ctx: MonitorContext,
  check: RuleCheck,
  state: StateClient
): Promise<{ matched: boolean; reason?: string }> {
  try {
    if (check.type === "paramIn") {
      return evalParamIn(ctx, check);
    }
    if (check.type === "balanceInRange") {
      return evalBalanceInRange(ctx, check, state);
    }
    if (check.type === "storageSlotEquals") {
      return evalStorageSlotEquals(ctx, check, state);
    }
    if (check.type === "callerNotIn") {
      return evalCallerNotIn(ctx, check, state);
    }
    if (check.type === "paramOutsideRange") {
      return evalParamOutsideRange(ctx, check);
    }
  } catch (err) {
    console.warn(
      "[rules-engine] 检查执行异常:",
      (err as Error)?.message ?? String(err)
    );
    return { matched: false };
  }
  return { matched: false };
}

/**
 * 执行一组规则，返回命中的规则列表（包含原因）。
 * - filter 模式：通常用于“命中才报警”
 * - annotate 模式：可由调用方决定仅用于附加说明
 */
export async function runRules(
  ctx: MonitorContext,
  rules: RuleConfig[] | undefined,
  stateClientOverride?: StateClient
): Promise<RuleResult[]> {
  if (!rules?.length) return [];

  const state = stateClientOverride ?? getDefaultStateClient(ctx.network);
  const results: RuleResult[] = [];

  for (const rule of rules) {
    if (!whenMatches(ctx, rule)) continue;
    let anyMatched = false;
    let reason: string | undefined;

    // 自定义 handler（若存在）优先
    const custom = getCustomRuleHandler(rule.handler);
    if (custom) {
      const res = await custom(ctx, rule, state);
      if (res && res.matched) {
        results.push(res);
        continue;
      }
    }

    const checks = rule.checks ?? [];
    for (const c of checks) {
      const { matched, reason: r } = await evalCheck(ctx, c, state);
      if (matched) {
        anyMatched = true;
        reason = r;
        break;
      }
    }

    if (anyMatched) {
      results.push({
        rule,
        matched: true,
        reason,
      });
    }
  }

  return results;
}

