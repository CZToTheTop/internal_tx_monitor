import { readFileSync } from "fs";
import { parse } from "yaml";
import { resolve } from "path";

/** 监控目标类型 */
export type MonitorType = "events" | "transactions" | "internal_calls";

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
