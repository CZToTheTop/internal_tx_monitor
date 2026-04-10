import type { MonitorContext, StateClient, RuleResult } from "./rules-engine.js";
import type { RuleConfig } from "./config.js";
import { getAddress } from "ethers";
import { erc20TransferUsdValue } from "./token-price.js";

export type CustomRuleHandler = (
  ctx: MonitorContext,
  rule: RuleConfig,
  state: StateClient
) => Promise<RuleResult | null>;

const HANDLERS: Record<string, CustomRuleHandler> = {};

export function registerCustomRuleHandler(name: string, handler: CustomRuleHandler): void {
  if (!name) return;
  HANDLERS[name] = handler;
}

export function getCustomRuleHandler(name: string | undefined): CustomRuleHandler | null {
  if (!name) return null;
  return HANDLERS[name] ?? null;
}

// 示例：监控 USDT transfer(amount < 1 USDT) 的 internal call
// 在 config.yaml 对应 target 的 rules 中配置：
//   rules:
//     - name: "usdt-transfer-amount-lt-1"
//       handler: "usdtTransferLt1"
registerCustomRuleHandler("usdtTransferLt1", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  if (ctx.functionName !== "transfer") return null;

  const args = ctx.args ?? [];
  const raw = args[1]; // transfer(address to, uint256 amount) 的 amount
  if (raw == null) return null;

  const amount = BigInt(String(raw)); // USDT 一般为 6 位小数，单位为 1e-6
  const ONE_USDT = BigInt(1_000_000); // 1 USDT

  if (amount < ONE_USDT) {
    return {
      rule,
      matched: true,
      reason: `USDT transfer amount < 1 USDT: ${amount.toString()}`,
    };
  }

  return { rule, matched: false };
});

// -------- Monite 文档相关 custom handlers --------

/** UMA OO: 价格不在 [0, 0.5, 1] 内（按 1e18 缩放）时告警；price 取 proposePrice / proposePriceFor / setPrice 的最后一个参数 */
registerCustomRuleHandler("optimisticOraclePriceAllowed", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  const name = (ctx.functionName ?? "").toLowerCase();
  if (name !== "proposeprice" && name !== "proposepricefor" && name !== "setprice") {
    return null;
  }
  const args = ctx.args ?? [];
  if (args.length === 0) return null;
  const raw = args[args.length - 1];
  if (raw == null) return null;
  const price = BigInt(String(raw));
  const ONE = BigInt(1e18);
  const allowed = [BigInt(0), ONE / BigInt(2), ONE]; // 0, 0.5, 1
  if (allowed.some((a) => a === price)) return { rule, matched: false };
  return {
    rule,
    matched: true,
    reason: `price ${price.toString()} 不在允许集合 [0, 0.5e18, 1e18]`,
  };
});

/**
 * ERC20 名义金额 USD 告警（transferERC20 / claim 等）：
 * - `functionNames`：允许的函数名小写列表，默认仅 `transfererc20`。
 * - 默认从 `tokenArgIndex` / `amountArgIndex` 取 token 与数量；若 `claim(uint256,bytes32[])` 等无 token 参数，可设 `fixedTokenAddress`（如链上 `REWARD_TOKEN()`）固定计价 token。
 * - 可选 `callerWhitelist`、无法估价与阈值逻辑同下。
 */
registerCustomRuleHandler("vaultTransferErc20UsdAlert", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  const fn = (ctx.functionName ?? "").toLowerCase();
  const allowedFns = (rule.params?.functionNames as string[] | undefined)?.map((x) => x.toLowerCase()) ?? [
    "transfererc20",
  ];
  if (!allowedFns.includes(fn)) return null;

  const threshold = Number(rule.params?.usdThreshold ?? 20_000);
  if (!Number.isFinite(threshold) || threshold < 0) return null;

  const tokenIdx = Number(rule.params?.tokenArgIndex ?? 0);
  const amountIdx = Number(rule.params?.amountArgIndex ?? 2);
  const args = ctx.args ?? [];
  const fixedRaw = (rule.params?.fixedTokenAddress as string | undefined)?.trim();
  let tokenStr: string;
  if (fixedRaw) {
    try {
      tokenStr = getAddress(fixedRaw);
    } catch {
      return null;
    }
  } else {
    const token = args[tokenIdx];
    if (token == null) return null;
    tokenStr = typeof token === "string" ? token : String(token);
  }

  const amountRaw = args[amountIdx];
  if (amountRaw == null) return null;

  let amountBn: bigint;
  try {
    amountBn = BigInt(String(amountRaw));
  } catch {
    return null;
  }

  const caller = (ctx.caller ?? "").toLowerCase();
  const wl = rule.params?.callerWhitelist as string[] | undefined;
  if (wl && wl.length > 0) {
    const ok = wl.some((a) => typeof a === "string" && a.toLowerCase() === caller);
    if (!ok) {
      return {
        rule,
        matched: true,
        reason: `caller ${ctx.caller ?? "?"} 不在白名单`,
      };
    }
  }

  const usd = await erc20TransferUsdValue(ctx.network, tokenStr, amountBn);
  if (usd === null) {
    return {
      rule,
      matched: true,
      reason: `无法对 token ${tokenStr} 估算 USD（无公开报价 / decimals 失败 / 不支持的网络），按 unknown 处理`,
    };
  }
  if (usd > threshold) {
    return {
      rule,
      matched: true,
      reason: `${fn} 约 $${usd.toFixed(2)} USD，超过阈值 $${threshold}`,
    };
  }
  return { rule, matched: false };
});

/** 任意命中即告警（用于“仅监控该调用，无需参数条件”的场景） */
registerCustomRuleHandler("alwaysAlert", async (ctx, rule, _state): Promise<RuleResult | null> => {
  return { rule, matched: true, reason: "命中监控范围" };
});

/**
 * 同 alwaysAlert，但在 reason 中附带**本次实际被调用的合约地址**（internal_call 取 trace.to；log 取 log.account）。
 * 适用于一个 target 监控多个合约地址时，在告警里区分是哪一家。
 */
registerCustomRuleHandler("alwaysAlertWithCallee", async (ctx, rule, _state): Promise<RuleResult | null> => {
  let callee: string | undefined;
  if (ctx.kind === "internal_call" && ctx.trace && typeof ctx.trace === "object") {
    const raw = (ctx.trace as { to?: { address?: string } }).to?.address;
    if (raw) {
      try {
        callee = getAddress(raw);
      } catch {
        callee = String(raw);
      }
    }
  } else if (ctx.kind === "log" && ctx.log && typeof ctx.log === "object") {
    const raw = (ctx.log as { account?: { address?: string } }).account?.address;
    if (raw) {
      try {
        callee = getAddress(raw);
      } catch {
        callee = String(raw);
      }
    }
  }
  const reason = callee
    ? `命中监控范围；被调用合约: ${callee}`
    : "命中监控范围（未能解析被调用合约地址）";
  return { rule, matched: true, reason };
});

/**
 * OpenZeppelin AccessControl：仅当 caller 对 `roleHashes` 中**任意**一个 role 的 `hasRole` 为 false 时告警。
 * 用于周期性喂价等函数：正常 keeper 有 OPERATOR_ROLE 或管理员有 DEFAULT_ADMIN_ROLE 时不报。
 *
 * params:
 * - `contract`: 实现 AccessControl 的合约地址（如 TBILL Oracle）
 * - `roleHashes`: bytes32 十六进制数组，如 `[OPERATOR_ROLE(), DEFAULT_ADMIN_ROLE()]`
 * - `functionNames`（可选）：限制在哪些函数名上执行校验（小写）
 */
registerCustomRuleHandler("alertIfNotAnyRole", async (ctx, rule, state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  const fn = (ctx.functionName ?? "").toLowerCase();
  const nameList = (rule.params?.functionNames as string[] | undefined)?.map((s) => s.toLowerCase());
  if (nameList?.length && !nameList.includes(fn)) return null;

  const contract = (rule.params?.contract as string | undefined)?.trim();
  const roleHashes = rule.params?.roleHashes as string[] | undefined;
  if (!contract || !roleHashes?.length) return null;

  const caller = ctx.caller?.trim();
  if (!caller) {
    return { rule, matched: true, reason: "无 caller，无法校验角色" };
  }
  if (!state.callView) {
    return { rule, matched: true, reason: "未实现 callView，无法校验 hasRole" };
  }

  for (const role of roleHashes) {
    try {
      const ok = await state.callView(
        contract,
        "function hasRole(bytes32 role, address account) view returns (bool)",
        [role, caller]
      );
      if (Boolean(ok)) {
        return { rule, matched: false };
      }
    } catch {
      // 试下一 role
    }
  }

  return {
    rule,
    matched: true,
    reason: `caller ${caller} 无已配置角色（${fn}）`,
  };
});

/**
 * 人工/应急结算 payout 二元校验：合法为 [0,1]、[1,0]、[1,1]（与 UMA OO 价格构造一致）。
 * 支持：emergencyResolve / resolveManually（bytes32 + uint256[]）、NegRiskOperator.emergencyResolveQuestion(bytes32,bool)。
 */
registerCustomRuleHandler("emergencyResolveOutcomeAllowed", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  const fn = (ctx.functionName ?? "").toLowerCase();
  const args = ctx.args ?? [];

  let a: number;
  let b: number;

  if (fn === "emergencyresolve" || fn === "resolvemanually") {
    const payouts = args[1];
    if (Array.isArray(payouts) && payouts.length >= 2) {
      a = Number(payouts[0]);
      b = Number(payouts[1]);
    } else {
      return null;
    }
  } else if (fn === "emergencyresolvequestion") {
    const result = args[1];
    if (typeof result === "boolean") {
      a = result ? 1 : 0;
      b = result ? 0 : 1;
    } else {
      const n = Number(result);
      if (n === 0 || n === 1) {
        a = n;
        b = 1 - n;
      } else {
        return null;
      }
    }
  } else {
    return null;
  }

  const ok =
    (a === 0 && b === 1) || (a === 1 && b === 0) || (a === 1 && b === 1);
  if (ok) return { rule, matched: false };
  return {
    rule,
    matched: true,
    reason: `${fn} payout 结果 (${a},${b}) 不在允许集合 [0,1],[1,0],[1,1]`,
  };
});

/** 事件金额超过阈值时告警（用于 PayoutRedemption 等）；阈值从 rule.params.threshold 读取（字符串，最小单位） */
registerCustomRuleHandler("eventAmountAbove", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "log" || !ctx.args?.length) return null;
  const thresholdRaw = rule.params?.threshold ?? rule.params?.min;
  if (thresholdRaw == null) return null;
  const threshold = BigInt(String(thresholdRaw));
  for (let i = 0; i < ctx.args.length; i++) {
    const v = ctx.args[i];
    if (v == null) continue;
    try {
      const n = BigInt(String(v));
      if (n > threshold) {
        return {
          rule,
          matched: true,
          reason: `事件参数[${i}]=${n} 超过阈值 ${threshold}`,
        };
      }
    } catch {
      // skip non-numeric
    }
  }
  return { rule, matched: false };
});

/**
 * 日志事件：按 token 地址 + 数量（最小单位）用 CoinGecko×decimals 换算 USD，超过阈值告警。
 * 适用于 `PayoutRedemption(address indexed redeemer, address indexed collateralToken, uint256 payout)` 等：
 * - `tokenArgIndex` / `amountArgIndex`：ABI 参数顺序下标（默认 1 / 2）。
 * - 可选 `eventName`：若填写则仅当 `ctx.eventName` 一致时评估。
 */
registerCustomRuleHandler("eventErc20UsdAbove", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "log" || !ctx.args?.length) return null;
  const en = rule.params?.eventName as string | undefined;
  if (en && (ctx.eventName ?? "") !== en) return null;

  const threshold = Number(rule.params?.usdThreshold ?? rule.params?.usdMin);
  if (!Number.isFinite(threshold) || threshold < 0) return null;

  const tokenIdx = Number(rule.params?.tokenArgIndex ?? 1);
  const amountIdx = Number(rule.params?.amountArgIndex ?? 2);
  const args = ctx.args;
  if (tokenIdx < 0 || amountIdx < 0 || tokenIdx >= args.length || amountIdx >= args.length) return null;

  const token = args[tokenIdx];
  const amountRaw = args[amountIdx];
  if (token == null || amountRaw == null) return null;

  const tokenStr = typeof token === "string" ? token : String(token);
  let amountBn: bigint;
  try {
    amountBn = BigInt(String(amountRaw));
  } catch {
    return null;
  }

  const usd = await erc20TransferUsdValue(ctx.network, tokenStr, amountBn);
  if (usd === null) {
    return {
      rule,
      matched: true,
      reason: `无法对 collateralToken ${tokenStr} 估算 USD（无报价 / decimals），按 unknown 处理`,
    };
  }
  if (usd > threshold) {
    const label = ctx.eventName ?? "event";
    return {
      rule,
      matched: true,
      reason: `${label} token=${tokenStr} 约 $${usd.toFixed(2)} USD，超过阈值 $${threshold}`,
    };
  }
  return { rule, matched: false };
});

