/**
 * 通过 debug_traceBlockByNumber 获取 internal trace 对应的 parent external tx hash
 * RPC 来源：各链 base URL + ALCHEMY_API_KEY；或完整 ETH_RPC、BNB_RPC 等覆盖
 */

const RPC_BASE: Record<string, string> = {
  ETH_MAINNET: "https://eth-mainnet.g.alchemy.com/v2/",
  ETH_SEPOLIA: "https://eth-sepolia.g.alchemy.com/v2/",
  BNB_MAINNET: "https://bnb-mainnet.g.alchemy.com/v2/",
  BNB_TESTNET: "https://bnb-testnet.g.alchemy.com/v2/",
  MATIC_MAINNET: "https://polygon-mainnet.g.alchemy.com/v2/",
  MATIC_AMOY: "https://polygon-amoy.g.alchemy.com/v2/",
  ARB_MAINNET: "https://arb-mainnet.g.alchemy.com/v2/",
  ARB_SEPOLIA: "https://arb-sepolia.g.alchemy.com/v2/",
  OP_MAINNET: "https://opt-mainnet.g.alchemy.com/v2/",
  OP_SEPOLIA: "https://opt-sepolia.g.alchemy.com/v2/",
  BASE_MAINNET: "https://base-mainnet.g.alchemy.com/v2/",
  BASE_SEPOLIA: "https://base-sepolia.g.alchemy.com/v2/",
};

const NETWORK_TO_RPC_ENV: Record<string, string> = {
  ETH_MAINNET: "ETH_RPC",
  ETH_SEPOLIA: "ETH_SEPOLIA_RPC",
  BNB_MAINNET: "BNB_RPC",
  BNB_TESTNET: "BNB_TESTNET_RPC",
  MATIC_MAINNET: "MATIC_RPC",
  MATIC_AMOY: "MATIC_AMOY_RPC",
  ARB_MAINNET: "ARB_RPC",
  ARB_SEPOLIA: "ARB_SEPOLIA_RPC",
  OP_MAINNET: "OP_RPC",
  OP_SEPOLIA: "OP_SEPOLIA_RPC",
  BASE_MAINNET: "BASE_RPC",
  BASE_SEPOLIA: "BASE_SEPOLIA_RPC",
};

/** 获取 RPC URL：优先链专属完整 URL；否则用 base + ALCHEMY_API_KEY */
export function getRpcUrl(network?: string): string {
  if (!network) return "";
  const envKey = NETWORK_TO_RPC_ENV[network];
  const custom = envKey ? process.env[envKey]?.trim() : "";
  if (custom && !custom.endsWith("/")) return custom;
  const base = RPC_BASE[network];
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (!base || !key) return custom || "";
  return (custom || base) + key;
}

type TraceFrame = {
  type?: string;
  from?: string;
  to?: string | null;
  input?: string;
  calls?: TraceFrame[];
};

type BlockTraceResult = {
  transactionHash?: string;
  result?: TraceFrame;
};

function addrEq(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** 从 trace 树中递归查找匹配 from/to/input 的 frame，返回其所在 tx 的 hash */
function findTraceInFrame(
  frame: TraceFrame,
  txHash: string,
  from: string | undefined,
  to: string | undefined,
  inputPrefix: string
): string | null {
  const fFrom = (frame.from ?? "").toLowerCase();
  const fTo = (frame.to ?? "").toLowerCase();
  const fInput = (frame.input ?? "").toLowerCase();
  if (addrEq(fFrom, from) && addrEq(fTo, to) && fInput.startsWith(inputPrefix)) {
    return txHash;
  }
  for (const c of frame.calls ?? []) {
    const found = findTraceInFrame(c, txHash, from, to, inputPrefix);
    if (found) return found;
  }
  return null;
}

/**
 * 调用 debug_traceBlockByNumber，解析出每个 trace 对应的 parent tx hash
 * @param rpcUrl RPC 端点（需支持 debug API）
 * @param blockNumber 区块号
 * @param traces webhook 中的 callTracerTraces 列表
 * @returns Map<traceIndex, txHash>，traceIndex 为 traces 数组下标
 */
export async function getTraceToTxMap(
  rpcUrl: string,
  blockNumber: number,
  traces: Array<{ from?: { address?: string }; to?: { address?: string }; input?: string }>
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!traces.length || !rpcUrl) return map;

  const blockHex = "0x" + blockNumber.toString(16);
  let result: BlockTraceResult[] | TraceFrame[];

  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "debug_traceBlockByNumber",
        params: [
          blockHex,
          { tracer: "callTracer", tracerConfig: { onlyTopCall: false } },
        ],
      }),
    });
    const json = (await res.json()) as { result?: BlockTraceResult[] | TraceFrame[]; error?: { message?: string } };
    if (json.error) {
      console.warn("[trace-api] RPC error:", json.error.message);
      return map;
    }
    result = json.result ?? [];
  } catch (err) {
    console.warn("[trace-api] RPC request failed:", err);
    return map;
  }

  if (!Array.isArray(result)) return map;

  // 若 RPC 返回的每项带 transactionHash，直接使用
  const hasTxHash = result.length > 0 && "transactionHash" in (result[0] ?? {});

  let txHashes: string[] = [];
  if (!hasTxHash) {
    // 否则用 eth_getBlockByNumber 获取 block 内 tx 列表，按 index 对应
    try {
      const blockRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getBlockByNumber",
          params: [blockHex, false],
        }),
      });
      const blockJson = (await blockRes.json()) as { result?: { transactions?: Array<{ hash?: string }> } };
      const txs = blockJson.result?.transactions ?? [];
      txHashes = txs.map((t) => (t.hash ?? "").toLowerCase()).filter(Boolean);
    } catch {
      return map;
    }
  }

  for (let i = 0; i < traces.length; i++) {
    const t = traces[i]!;
    const from = t.from?.address?.toLowerCase();
    const to = t.to?.address?.toLowerCase();
    const input = (t.input ?? "").toLowerCase();
    const inputPrefix = input.slice(0, 10); // 0x + 4 bytes selector

    for (let j = 0; j < result.length; j++) {
      const item = result[j]!;
      const txHash = hasTxHash
        ? (item as BlockTraceResult).transactionHash
        : txHashes[j];
      const frame = hasTxHash ? (item as BlockTraceResult).result : (item as TraceFrame);
      if (!frame || !txHash) continue;
      const found = findTraceInFrame(frame, txHash, from, to, inputPrefix);
      if (found) {
        map.set(i, found);
        break;
      }
    }
  }
  return map;
}
