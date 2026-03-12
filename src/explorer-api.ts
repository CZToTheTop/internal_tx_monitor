/**
 * 通过 Etherscan API V2 的 txlistinternal 获取 internal trace 对应的 parent tx hash
 * 统一使用 https://api.etherscan.io/v2/api?chainid=X，一个 ETHERSCAN_API_KEY 支持多链
 * @see https://docs.etherscan.io/v2-migration
 */

const V2_BASE = "https://api.etherscan.io/v2/api";

const NETWORK_TO_CHAINID: Record<string, number> = {
  ETH_MAINNET: 1,
  ETH_SEPOLIA: 11155111,
  BNB_MAINNET: 56,
  BNB_TESTNET: 97,
  MATIC_MAINNET: 137,
  MATIC_AMOY: 80002,
  ARB_MAINNET: 42161,
  ARB_SEPOLIA: 421614,
  OP_MAINNET: 10,
  OP_SEPOLIA: 11155420,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
};

type InternalTxItem = {
  blockNumber?: string;
  hash?: string;
  from?: string;
  to?: string;
  contractAddress?: string;
  input?: string;
  type?: string;
};

function addrEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 调用 Etherscan API V2 txlistinternal，按 from/to/input 匹配 webhook traces，返回 traceIndex → parent tx hash
 */
export async function getTraceToTxMapFromExplorer(
  network: string,
  blockNumber: number,
  traces: Array<{ from?: { address?: string }; to?: { address?: string }; input?: string }>
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!traces.length) return map;

  const chainId = NETWORK_TO_CHAINID[network];
  if (chainId == null) {
    console.warn("[explorer-api] 未支持的 network:", network);
    return map;
  }

  // V2 统一用 ETHERSCAN_API_KEY；BNB 链可回退到 BSCSCAN_API_KEY（部分场景兼容）
  const apiKey =
    process.env.ETHERSCAN_API_KEY?.trim() ||
    (chainId === 56 || chainId === 97 ? process.env.BSCSCAN_API_KEY?.trim() : undefined);
  if (!apiKey) {
    console.warn("[explorer-api] 未设置 ETHERSCAN_API_KEY（V2 需从 https://etherscan.io/apidashboard 获取）");
    return map;
  }

  const url = `${V2_BASE}?chainid=${chainId}&module=account&action=txlistinternal&startblock=${blockNumber}&endblock=${blockNumber}&page=1&offset=10000&sort=asc&apikey=${apiKey}`;

  try {
    const res = await fetch(url);
    const json = (await res.json()) as { status?: string; message?: string; result?: InternalTxItem[] | string };
    if (json.status !== "1") {
      const err = typeof json.result === "string" ? json.result : json.message ?? "unknown";
      console.warn("[explorer-api] 请求失败:", err);
      return map;
    }
    const result = json.result;
    const items = Array.isArray(result) ? result : [];

    for (let i = 0; i < traces.length; i++) {
      const t = traces[i]!;
      const from = t.from?.address?.toLowerCase();
      const to = t.to?.address?.toLowerCase();
      const input = (t.input ?? "").toLowerCase();
      const inputPrefix = input.slice(0, 10); // 0x + 4 bytes selector

      for (const item of items) {
        const h = item.hash;
        if (!h) continue;
        const itemFrom = (item.from ?? "").toLowerCase();
        const itemTo = (item.to ?? item.contractAddress ?? "").toLowerCase();
        const itemInput = (item.input ?? "").toLowerCase();
        if (addrEq(from, itemFrom) && addrEq(to, itemTo) && itemInput.startsWith(inputPrefix)) {
          map.set(i, h);
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[explorer-api] 请求异常:", err);
  }
  return map;
}
