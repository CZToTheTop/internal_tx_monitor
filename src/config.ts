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
  /** 仅 transactions: 过滤 from 地址 */
  txFrom?: string[];
  /** 仅 transactions: 过滤 to 地址 */
  txTo?: string[];
  /** 可选标签，用于日志区分 */
  label?: string;
}

/** 主配置 */
export interface Config {
  /** 监听的链/网络 */
  network: string;
  /** 监控目标列表 */
  targets: MonitorTarget[];
  /** Webhook 接收地址 (需公网可访问，如 ngrok) */
  webhookUrl: string;
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
  const parsed = parse(raw) as Config;
  if (!parsed.network || !parsed.targets?.length) {
    throw new Error("config.yaml 必须包含 network, targets");
  }
  parsed.webhookUrl = parsed.webhookUrl ?? "";
  parsed.network = NETWORK_MAP[parsed.network] ?? parsed.network;
  for (const t of parsed.targets) {
    if (t.network) t.network = NETWORK_MAP[t.network] ?? t.network;
  }
  return parsed;
}
