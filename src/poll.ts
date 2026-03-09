#!/usr/bin/env node
/**
 * 轮询模式：通过 RPC eth_getLogs 拉取事件，无需 webhook/隧道
 * 用法: RPC_URL=https://... npm run poll
 * 或设置 .env 中的 BSC_RPC_URL / ALCHEMY_BSC_URL 等
 */
import "dotenv/config";
import { loadConfig } from "./config.js";
import { parseTransferFromLog, formatTransferValue } from "./transfer-parser.js";

const RPC_MAP: Record<string, string> = {
  bsc_mainnet: process.env.BSC_RPC_URL ?? process.env.ALCHEMY_BSC_URL ?? "https://bsc.publicnode.com",
  bnb_mainnet: process.env.BSC_RPC_URL ?? process.env.ALCHEMY_BSC_URL ?? "https://bsc.publicnode.com",
  bsc_testnet: "https://bsc-testnet.publicnode.com",
  bnb_testnet: "https://bsc-testnet.publicnode.com",
  eth_mainnet: process.env.ETH_RPC_URL ?? process.env.ALCHEMY_ETH_URL ?? "https://eth.llamarpc.com",
  eth_sepolia: "https://rpc.sepolia.org",
  polygon_mainnet: "https://polygon.publicnode.com",
  matic_mainnet: "https://polygon.publicnode.com",
  arbitrum_mainnet: "https://arb1.arbitrum.io/rpc",
  arb_mainnet: "https://arb1.arbitrum.io/rpc",
  optimism_mainnet: "https://mainnet.optimism.io",
  op_mainnet: "https://mainnet.optimism.io",
  base_mainnet: "https://mainnet.base.org",
};

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function getBlockNumber(url: string): Promise<number> {
  const hex = await rpc<string>(url, "eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function getLogs(
  url: string,
  fromBlock: number,
  toBlock: number,
  addresses: string[],
  topics: string[]
): Promise<{ address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string }[]> {
  const result = await rpc<
    { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string }[]
  >(url, "eth_getLogs", [
    {
      address: addresses.length === 1 ? addresses[0] : addresses,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
      topics: topics.length ? topics : undefined,
    },
  ]);
  return result ?? [];
}

async function main() {
  const config = process.env.CONFIG_PATH ? loadConfig(process.env.CONFIG_PATH) : loadConfig();

  const netKey = config.network.toLowerCase().replace(/-/g, "_");
  const rpcUrl = process.env.RPC_URL ?? RPC_MAP[netKey];
  if (!rpcUrl) {
    throw new Error(`未配置 RPC_URL，且 network ${config.network} 无默认 RPC`);
  }

  const intervalMs = parseInt(process.env.POLL_INTERVAL ?? "12000", 10);

  let lastBlock = await getBlockNumber(rpcUrl);
  console.log(`[Poll] 开始监控 ${config.network}，当前块 ${lastBlock}，间隔 ${intervalMs}ms`);

  for (const target of config.targets) {
    if (target.type !== "events") continue;
    const addrs = target.addresses;
    const topics = target.topics ?? [];
    const label = target.label ?? "events";

    setInterval(async () => {
      try {
        const currentBlock = await getBlockNumber(rpcUrl);
        if (currentBlock <= lastBlock) return;

        const logs = await getLogs(
          rpcUrl,
          lastBlock + 1,
          currentBlock,
          addrs,
          topics
        );

        if (logs.length) {
          for (const log of logs) {
            const t = parseTransferFromLog({
              address: log.address,
              topics: log.topics ?? [],
              data: log.data ?? "0x",
            });
            if (t) {
              console.log(
                `[${label}] ${t.from} -> ${t.to} | ${formatTransferValue(t.value)} | tx ${log.transactionHash}`
              );
            }
          }
        }

        lastBlock = currentBlock;
      } catch (err) {
        console.error("[Poll] error:", err);
      }
    }, intervalMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
