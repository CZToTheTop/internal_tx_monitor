import type { MonitorContext, StateClient, RuleResult } from "./rules-engine.js";
import type { RuleConfig } from "./config.js";

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

/** UMA OO: 价格不在 [0, 0.5, 1] 内（按 1e18 缩放）时告警 */
registerCustomRuleHandler("optimisticOraclePriceAllowed", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call") return null;
  const name = (ctx.functionName ?? "").toLowerCase();
  if (name !== "proposeprice" && name !== "setprice") return null;
  const args = ctx.args ?? [];
  const raw = args[0] ?? args[1]; // 通常 price 为第一或第二参数
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

/** 任意命中即告警（用于“仅监控该调用，无需参数条件”的场景） */
registerCustomRuleHandler("alwaysAlert", async (ctx, rule, _state): Promise<RuleResult | null> => {
  return { rule, matched: true, reason: "命中监控范围" };
});

/** emergencyResolve: 结果不在 [(0,1), (1,0), (1,1)] 时告警 */
registerCustomRuleHandler("emergencyResolveOutcomeAllowed", async (ctx, rule, _state): Promise<RuleResult | null> => {
  if (ctx.kind !== "internal_call" || ctx.functionName !== "emergencyResolve") return null;
  const args = ctx.args ?? [];
  const a = Number(args[0] ?? -1);
  const b = Number(args[1] ?? -1);
  const ok =
    (a === 0 && b === 1) || (a === 1 && b === 0) || (a === 1 && b === 1);
  if (ok) return { rule, matched: false };
  return {
    rule,
    matched: true,
    reason: `emergencyResolve 结果 (${a},${b}) 不在允许集合 [0,1],[1,0],[1,1]`,
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

