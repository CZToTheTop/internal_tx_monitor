/**
 * 通过 debug_traceBlockByNumber 获取 internal trace 对应的 parent external tx hash
 * RPC 来源：RPC_URL 环境变量，或从 ALCHEMY_API_KEY + network 推导
 */

const NETWORK_TO_ALCHEMY: Record<string, string> = {
  ETH_MAINNET: "eth-mainnet",
  ETH_SEPOLIA: "eth-sepolia",
  BNB_MAINNET: "bnb-mainnet",
  BNB_TESTNET: "bnb-testnet",
  MATIC_MAINNET: "polygon-mainnet",
  MATIC_AMOY: "polygon-amoy",
  ARB_MAINNET: "arb-mainnet",
  ARB_SEPOLIA: "arb-sepolia",
  OP_MAINNET: "optimism-mainnet",
  OP_SEPOLIA: "optimism-sepolia",
  BASE_MAINNET: "base-mainnet",
  BASE_SEPOLIA: "base-sepolia",
};

/** 获取 RPC URL：优先 RPC_URL，否则从 ALCHEMY_API_KEY + network 推导 */
export function getRpcUrl(network?: string): string {
  const url = process.env.RPC_URL?.trim();
  if (url) return url;
  const key = process.env.ALCHEMY_API_KEY?.trim();
  const sub = network ? NETWORK_TO_ALCHEMY[network] : null;
  if (key && sub) return `https://${sub}.g.alchemy.com/v2/${key}`;
  return "";
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
