#!/usr/bin/env node
/**
 * 用指定交易模拟 Alchemy Webhook 推送，测试 trace→tx 映射
 * 用法: TX_HASH=0xc29d220ca1aebe969fbbf3e0af5a0d5bd11ff1ff8859b79f4f3ec159c2a36a17 npm run test:tx:webhook
 * 需先启动: npm run monitor
 */
import "dotenv/config";
import { createHmac } from "crypto";
import http from "http";
import { loadConfig } from "../src/config.js";
import { getTraceToTxMapFromExplorer } from "../src/explorer-api.js";
import { getRpcUrl, getTraceToTxMap } from "../src/trace-api.js";

const TX_HASH = process.env.TX_HASH ?? "0xc29d220ca1aebe969fbbf3e0af5a0d5bd11ff1ff8859b79f4f3ec159c2a36a17";

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

const RPC_FALLBACK: Record<string, string> = {
  BNB_MAINNET: "https://bsc.publicnode.com",
  BNB_TESTNET: "https://bsc-testnet.publicnode.com",
  ETH_MAINNET: "https://eth.llamarpc.com",
};

async function main() {
  const config = process.env.CONFIG_PATH ? loadConfig(process.env.CONFIG_PATH) : loadConfig();
  const rpcUrl =
    getRpcUrl(config.network) ||
    process.env.RPC_URL ||
    process.env.BSC_RPC_URL ||
    process.env.ALCHEMY_BSC_URL ||
    RPC_FALLBACK[config.network];
  if (!rpcUrl) {
    console.error("请设置 RPC_URL、ALCHEMY_API_KEY 或 BSC_RPC_URL");
    process.exit(1);
  }

  console.log(`\n📡 获取交易: ${TX_HASH}`);
  console.log(`   RPC: ${rpcUrl}\n`);

  const receipt = await rpc<{ blockNumber: string; blockHash: string }>(rpcUrl, "eth_getTransactionReceipt", [TX_HASH]);
  if (!receipt) {
    console.error("交易不存在或尚未确认");
    process.exit(1);
  }

  const blockNum = parseInt(receipt.blockNumber, 16);
  const block = await rpc<{ hash: string; transactions: string[] }>(rpcUrl, "eth_getBlockByNumber", [
    "0x" + blockNum.toString(16),
    false,
  ]);
  if (!block) {
    console.error("无法获取区块");
    process.exit(1);
  }

  // 调用 debug_traceBlockByNumber 获取 traces
  const traceRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "debug_traceBlockByNumber",
      params: ["0x" + blockNum.toString(16), { tracer: "callTracer", tracerConfig: { onlyTopCall: false } }],
    }),
  });
  const traceJson = (await traceRes.json()) as { result?: unknown[]; error?: { message?: string } };
  if (traceJson.error) {
    console.warn("debug_traceBlockByNumber 失败:", traceJson.error.message, "(部分 RPC 不支持此方法)");
  }
  const traceResult = Array.isArray(traceJson.result) ? traceJson.result : [];

  // 展平 trace 树为 webhook 格式（from/to/input，故意不含 transaction 以测试 trace API）
  type TraceItem = { from?: { address?: string }; to?: { address?: string }; input?: string };
  const traces: TraceItem[] = [];
  function flatten(frame: { from?: string; to?: string; input?: string; calls?: unknown[] }, _depth: number) {
    if (frame && (frame.from || frame.to)) {
      traces.push({
        from: frame.from ? { address: frame.from } : undefined,
        to: frame.to ? { address: frame.to } : undefined,
        input: (frame.input ?? "0x").toLowerCase(),
      });
    }
    for (const c of frame?.calls ?? []) {
      flatten(c as { from?: string; to?: string; input?: string; calls?: unknown[] }, _depth + 1);
    }
  }
  for (const item of traceResult) {
    const obj = item as { result?: unknown; transactionHash?: string };
    const root = (obj.result ?? item) as { from?: string; to?: string; input?: string; calls?: unknown[] };
    if (root && typeof root === "object") flatten(root, 0);
  }

  // 若 RPC 无 trace，用该 tx 的 receipt + 单条 mock trace 模拟
  if (traces.length === 0) {
    const tx = await rpc<{ from: string; to: string; input: string }>(rpcUrl, "eth_getTransactionByHash", [TX_HASH]);
    if (tx) {
      traces.push({
        from: { address: tx.from },
        to: tx.to ? { address: tx.to } : undefined,
        input: (tx.input ?? "0x").toLowerCase(),
      });
      console.log("RPC 无 trace，使用 tx 构建单条 mock trace");
    }
  }

  console.log(`Block: ${blockNum}, 交易数: ${block.transactions?.length ?? 0}, 展平 traces: ${traces.length}`);

  // 验证 trace→tx 映射：优先 Explorer API，否则 RPC
  let map = await getTraceToTxMapFromExplorer(config.network, blockNum, traces);
  if (map.size < traces.length && rpcUrl) {
    const rpcMap = await getTraceToTxMap(rpcUrl, blockNum, traces);
    for (const [k, v] of rpcMap) {
      if (!map.has(k)) map.set(k, v);
    }
  }
  const targetTx = TX_HASH.toLowerCase();
  const matched = [...map.entries()].filter(([, h]) => h?.toLowerCase() === targetTx);
  console.log(`trace→tx 映射: ${map.size} 条 (Explorer API 优先), 其中属于目标 tx 的: ${matched.length} 条`);

  // 构建 mock webhook payload（traces 不含 transaction，触发 trace API）
  // transactions 需为 { hash } 格式；将目标 tx 放首位以便 getTxHash 能取到
  const txHashes = (block.transactions ?? []) as string[];
  const targetIdx = txHashes.findIndex((h) => (h ?? "").toLowerCase() === TX_HASH.toLowerCase());
  const ordered = targetIdx >= 0 ? [TX_HASH, ...txHashes.filter((h, i) => i !== targetIdx)] : txHashes;
  const txObjects = ordered.slice(0, 20).map((h) => ({ hash: typeof h === "string" ? h : (h as { hash?: string }).hash ?? "" }));

  const payload = JSON.stringify({
    id: "test-tx-" + Date.now(),
    webhookId: "wh_test",
    type: "GRAPHQL",
    createdAt: new Date().toISOString(),
    event: {
      data: {
        block: {
          number: blockNum,
          hash: block.hash,
          timestamp: new Date().toISOString(),
          logs: [],
          transactions: txObjects,
          callTracerTraces: traces.slice(0, 50), // 限制数量
        },
      },
    },
  });

  const signingKey =
    process.env.SIGNING_KEY ??
    process.env.SIGNING_KEYS?.split(",")[0] ??
    config.singleWebhookSigningKey ??
    config.webhookGroups?.[0]?.signingKey;
  if (!signingKey) {
    console.error("请设置 .env 中的 SIGNING_KEY 或 config 中的 signing_key");
    process.exit(1);
  }

  const sig = createHmac("sha256", signingKey).update(payload, "utf8").digest("hex");

  const port = process.env.PORT ?? "8080";
  console.log(`\n📤 发送 mock webhook 到 http://127.0.0.1:${port}/webhook ...`);

  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/webhook",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Alchemy-Signature": sig,
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        console.log(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
        console.log(res.statusCode === 200 ? "✅ 测试完成" : "❌ 失败");
      });
    }
  );
  req.on("error", (e) => {
    console.error("请求失败:", e.message);
    console.log("请先运行: npm run monitor");
    process.exit(1);
  });
  req.write(payload);
  req.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
