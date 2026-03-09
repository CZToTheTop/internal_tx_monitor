#!/usr/bin/env node
/**
 * 测试脚本：获取指定交易并提取 transfer() 参数
 * 用法: BSC_RPC_URL=https://... npm run test:tx
 * 或使用 Alchemy BSC: ALCHEMY_BSC_URL=https://bnb-mainnet.g.alchemy.com/v2/YOUR_KEY
 */
import "dotenv/config";

const TX_HASH = "0x2ac796be3a9477ed58f45877e7608f1177d08d7777a0eb2e7ee9c6347940518b";

const BSC_RPC =
  process.env.BSC_RPC_URL ??
  process.env.ALCHEMY_BSC_URL ??
  "https://bsc.publicnode.com";

async function getTransactionReceipt(rpcUrl: string, txHash: string) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function getTransaction(rpcUrl: string, txHash: string) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionByHash",
      params: [txHash],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

import {
  parseTransferFromLog,
  parseTransferFromInput,
  formatTransferValue,
} from "./transfer-parser.js";

async function main() {
  console.log(`\n📡 获取交易: ${TX_HASH}`);
  console.log(`   RPC: ${BSC_RPC}\n`);

  const [receipt, tx] = await Promise.all([
    getTransactionReceipt(BSC_RPC, TX_HASH),
    getTransaction(BSC_RPC, TX_HASH),
  ]);

  if (!receipt) {
    console.error("交易不存在或尚未确认");
    process.exit(1);
  }

  console.log("=== 交易概览 ===");
  console.log(`Block: ${parseInt(receipt.blockNumber, 16)}`);
  console.log(`From: ${tx.from}`);
  console.log(`To: ${tx.to}`);
  console.log(`Status: ${receipt.status === "0x1" ? "Success" : "Failed"}`);
  console.log("");

  // 1. 从 Event Logs 解析 Transfer
  const transfers: ReturnType<typeof parseTransferFromLog>[] = [];
  for (const log of receipt.logs ?? []) {
    const t = parseTransferFromLog({
      address: log.address,
      topics: log.topics ?? [],
      data: log.data ?? "0x",
    });
    if (t) transfers.push(t);
  }

  console.log("=== Transfer 参数 (来自 ERC20 Transfer 事件) ===");
  if (transfers.length === 0) {
    console.log("未找到 Transfer 事件");
  } else {
    for (let i = 0; i < transfers.length; i++) {
      const t = transfers[i]!;
      console.log(`\n[Transfer #${i + 1}]`);
      console.log(`  token:  ${t.token}`);
      console.log(`  from:   ${t.from}`);
      console.log(`  to:     ${t.to}`);
      console.log(`  value:  ${t.value.toString()} (raw)`);
      console.log(`  value:  ${formatTransferValue(t.value)} (formatted, 18 decimals)`);
    }
  }

  // 2. 尝试从 input 解析（若为直接 transfer 调用）
  if (tx.input && tx.input.length > 138) {
    const fromInput = parseTransferFromInput(tx.input, tx.from, tx.to ?? "");
    if (fromInput) {
      console.log("\n=== Transfer 参数 (来自交易 input) ===");
      console.log(`  from:   ${fromInput.from}`);
      console.log(`  to:     ${fromInput.to}`);
      console.log(`  value:  ${formatTransferValue(fromInput.value)}`);
    }
  }

  // 3. 内部调用的 transfer：从 receipt 的 logs 已覆盖，若需 trace 可扩展
  console.log("\n✅ 解析完成\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
