import { readFileSync } from "fs";
import { parse } from "yaml";
import { resolve } from "path";

/** 监控目标类型 */
export type MonitorType = "events" | "transactions" | "internal_calls";

/** 单条规则的触发条件（在 target 命中之后的二级过滤） */
export interface RuleWhen {
  /** 函数名称或完整签名，如 `revokeRole(bytes32,address)`；仅对 transactions/internal_calls 有意义 */
  function?: string;
  /** 事件名称或完整签名，如 `Transfer(address,address,uint256)`；仅对 events 有意义 */
  event?: string;
}

/** 规则检查类型（后续在 rules-engine 中具体实现） */
export type RuleCheck =
  | {
      /** 检查 decoded 参数是否在允许集合内（白名单） */
      type: "paramIn";
      /** 第几个参数（0-based） */
      argIndex: number;
      /** 允许的取值列表，字符串或数字，具体比较逻辑由规则引擎实现 */
      allowed: unknown[];
    }
  | {
      /** 原生币 / ERC20 余额区间检查 */
      type: "balanceInRange";
      /**
       * 要检查余额的地址（直接写死），与 addressRef 二选一；
       * 如不填写则由规则引擎按上下文推断（通常为 target 合约地址）
       */
      address?: string;
      /**
       * 从上下文取地址的引用：tx.to / tx.from / target 等；
       * 仅用于简化配置，不做强约束，具体含义由规则引擎解释
       */
      addressRef?: "tx.to" | "tx.from" | "target";
      /**
       * token 标识：
       * - "native" 表示链原生币
       * - 其他字符串可由规则引擎解释为 token 合约地址
       */
      token?: string;
      /** 最小值（含），支持数字或字符串（由规则引擎做单位换算与精度处理） */
      min?: string | number;
      /** 最大值（含），支持数字或字符串 */
      max?: string | number;
    }
  | {
      /** 固定 storage slot 比较 */
      type: "storageSlotEquals";
      /** storage slot（十六进制字符串） */
      slot: string;
      /** 预期值（十六进制字符串），比较逻辑由规则引擎实现 */
      expected: string;
    }
  | {
      /** 调用者不在白名单时告警（caller = tx.from 或 trace.from） */
      type: "callerNotIn";
      /** 允许的 caller 地址列表；空数组表示不告警 */
      allowed: string[];
    }
  | {
      /** 参数超出数值区间时告警（用于 feeBips、amount 等） */
      type: "paramOutsideRange";
      /** 第几个参数（0-based） */
      argIndex: number;
      /** 最小值（含），不填则不这下界 */
      min?: string | number;
      /** 最大值（含），不填则不设上界 */
      max?: string | number;
    };

/** 单条规则配置：由 target 派生出的细粒度监控规则 */
export interface RuleConfig {
  /** 规则名（可选），用于日志与报警展示 */
  name?: string;
  /** 规则说明，用于报警文案补充 */
  description?: string;
  /** 告警严重级别，仅用于展示，不影响执行 */
  severity?: "info" | "low" | "medium" | "high" | "critical";
  /**
   * 规则模式：
   * - filter：默认模式，仅当规则命中时才发送报警
   * - annotate：规则仅增加附加信息，不改变是否报警的决策
   */
  mode?: "filter" | "annotate";
  /** 触发条件：在 target 命中之后进一步过滤具体函数/事件/参数 */
  when?: RuleWhen;
  /** 具体检查列表（与 handler 二选一或组合） */
  checks?: RuleCheck[];
  /**
   * 自定义 handler 名称：由代码侧注册，实现复杂逻辑；
   * 若存在，则由规则引擎优先调用对应 handler
   */
  handler?: string;
  /** 自定义 handler 的可选参数（如 threshold、scale 等），由 handler 自行解析 */
  params?: Record<string, unknown>;
}

/** 单个监控目标配置 */
export interface MonitorTarget {
  /** 监控类型: events=合约事件, transactions=外部交易, internal_calls=内部调用(含 call/delegatecall) */
  type: MonitorType;
  /** 合约地址列表 (checksum 格式) */
  addresses: string[];
  /** 可选：该 target 所属链（events/transactions/internal_calls 均可配置），不填则用顶层 network */
  network?: string;
  /** 可选：该监控对应的 Alchemy Webhook Signing Key，用于区分入站请求属于哪个 target */
  signing_key?: string;
  /** 仅 events 类型: 事件 topic 过滤，空数组表示匹配所有事件 */
  topics?: string[];
  /** 仅 internal_calls: 过滤 from 地址，空表示任意 */
  fromAddresses?: string[];
  /** 仅 internal_calls: 过滤 to 地址，空表示任意 */
  toAddresses?: string[];
  /** 仅 internal_calls: 按 method selector 过滤（input 前 4 字节），如 transfer 为 0xa9059cbb；配置后仅 input 匹配的 internal call 会触发报警 */
  methodSelectors?: string[];
  /** 仅 internal_calls: 内联 ABI，用于 decode input 参数；与 abiPath 二选一 */
  abi?: object[];
  /** 仅 internal_calls: ABI 文件路径（相对项目根），用于 decode input；与 abi 二选一；不配则尝试从 Explorer API 拉取 to 合约 ABI */
  abiPath?: string;
  /** 仅 transactions: 过滤 from 地址 */
  txFrom?: string[];
  /** 仅 transactions: 过滤 to 地址 */
  txTo?: string[];
  /** 可选标签，用于日志区分 */
  label?: string;
  /** 可选：该 target 下的细粒度规则列表；为空或省略时保留“命中即报警”的旧行为 */
  rules?: RuleConfig[];
}

/** 一个 signing_key 对应的一组规则（收到 event 后先按 signing_key 分流，再在该组内按规则匹配） */
export interface WebhookGroup {
  signingKey: string;
  targets: MonitorTarget[];
}

/** 主配置 */
export interface Config {
  /** 监听的链/网络 */
  network: string;
  /** 监控目标列表（单 Webhook / 多 Webhook 时用）；多组模式时由 webhookGroups 提供） */
  targets: MonitorTarget[];
  /** Webhook 接收地址 (需公网可访问，如 ngrok) */
  webhookUrl: string;
  /**
   * 单 Webhook 模式：整份 config 只创建 1 个 Alchemy Webhook，在服务端按 target 做多维度筛查并分别报警。
   * 此时 signing_key 应写在 targets 下（targets.signing_key），而非每个 target 的 type 后。
   */
  singleWebhook?: boolean;
  /** 单 Webhook 模式下的唯一 Signing Key，从 targets.signing_key 解析得到 */
  singleWebhookSigningKey?: string;
  /**
   * 多组模式：每个 signing_key 对应一组规则。收到 event 后先按 signing_key 分流到对应组，再在该组内按规则匹配并报警。
   * 配置为 targets: [ { signing_key, list: [...] }, { signing_key, list: [...] } ] 时解析得到。
   */
  webhookGroups?: WebhookGroup[];
}

const NETWORK_MAP: Record<string, string> = {
  eth_mainnet: "ETH_MAINNET",
  eth_sepolia: "ETH_SEPOLIA",
  bsc_mainnet: "BNB_MAINNET",
  bsc_testnet: "BNB_TESTNET",
  polygon_mainnet: "MATIC_MAINNET",
  polygon_amoy: "MATIC_AMOY",
  arbitrum_mainnet: "ARB_MAINNET",
  arbitrum_sepolia: "ARB_SEPOLIA",
  optimism_mainnet: "OP_MAINNET",
  optimism_sepolia: "OP_SEPOLIA",
  base_mainnet: "BASE_MAINNET",
  base_sepolia: "BASE_SEPOLIA",
};

export function loadConfig(path?: string): Config {
  const base = process.cwd();
  const configPath = path ? resolve(base, path) : resolve(base, "config.yaml");
  const realPath = resolve(configPath);
  if (!realPath.startsWith(base)) {
    throw new Error("CONFIG_PATH 不能指向项目目录外");
  }
  const raw = readFileSync(realPath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;
  if (!parsed.network) {
    throw new Error("config.yaml 必须包含 network");
  }
  const network = NETWORK_MAP[parsed.network as string] ?? (parsed.network as string);
  const webhookUrl = (parsed.webhookUrl as string) ?? "";

  let targets: MonitorTarget[];
  let singleWebhookSigningKey: string | undefined;
  let webhookGroups: WebhookGroup[] | undefined;

  const rawTargets = parsed.targets;
  const first = Array.isArray(rawTargets) && rawTargets.length > 0 ? rawTargets[0] : null;
  const isGroupItem =
    first &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    "list" in first &&
    Array.isArray((first as { list?: unknown[] }).list) &&
    "signing_key" in first;

  if (Array.isArray(rawTargets) && rawTargets.length > 0 && isGroupItem) {
    webhookGroups = (rawTargets as { signing_key?: string; list: MonitorTarget[] }[]).map((g) => ({
      signingKey: (g.signing_key ?? "").trim(),
      targets: g.list ?? [],
    }));
    targets = webhookGroups.flatMap((g) => g.targets);
    singleWebhookSigningKey = undefined;
    if (targets.length === 0) {
      throw new Error("config.yaml 至少一个 group 的 list 不能为空");
    }
  } else if (Array.isArray(rawTargets) && rawTargets.length > 0) {
    targets = rawTargets as MonitorTarget[];
    singleWebhookSigningKey = undefined;
    webhookGroups = undefined;
  } else if (
    rawTargets &&
    typeof rawTargets === "object" &&
    !Array.isArray(rawTargets) &&
    Array.isArray((rawTargets as { list?: unknown[] }).list)
  ) {
    const obj = rawTargets as { signing_key?: string; list: MonitorTarget[] };
    singleWebhookSigningKey = obj.signing_key?.trim() || undefined;
    targets = obj.list;
    webhookGroups = undefined;
    if (!targets.length) {
      throw new Error("config.yaml targets.list 不能为空");
    }
  } else {
    throw new Error(
      "config.yaml 的 targets 须为：数组（多 Webhook）、含 list 的对象（单 Webhook）、或「数组的数组」每项为 { signing_key, list }（多组）"
    );
  }

  for (const t of targets) {
    if (t.network) t.network = NETWORK_MAP[t.network] ?? t.network;
    // 对 rules 做最小 shape 校验：若存在则必须为数组
    if (t.rules != null && !Array.isArray(t.rules)) {
      throw new Error("config.yaml: target.rules 必须为数组");
    }
  }

  return {
    network,
    targets,
    webhookUrl,
    singleWebhook: parsed.singleWebhook as boolean | undefined,
    singleWebhookSigningKey,
    webhookGroups,
  };
}
