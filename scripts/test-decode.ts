#!/usr/bin/env node
/**
 * 测试 ABI 解码：拉取 to 合约 ABI 并 decode input
 * 用法: npm run test:decode
 * 需配置: ETHERSCAN_API_KEY；proxy 检测需 ALCHEMY_API_KEY
 */
import "dotenv/config";
import {
  getAbiFromExplorer,
  decodeInput,
  formatDecodedInput,
} from "../src/abi-decoder.js";
import { getRpcUrl } from "../src/trace-api.js";

const TO_ADDRESS = "0x5763DDeB60c82684F3D0098aEa5076C0Da972ec7";
const INPUT =
  "0xb6b55f2500000000000000000000000000000000000000000000fe1c215e8f838e000000";
const NETWORK = "BNB_MAINNET";

async function main() {
  console.log("To:", TO_ADDRESS);
  console.log("Input:", INPUT);
  console.log("Network:", NETWORK);
  console.log("RPC:", getRpcUrl(NETWORK) ? "已配置" : "未配置（proxy 检测需 ALCHEMY_API_KEY）");
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error("需要 ETHERSCAN_API_KEY");
    process.exit(1);
  }

  let abi: object[] | null = null;
  try {
    abi = await getAbiFromExplorer(TO_ADDRESS, NETWORK);
  } catch (err) {
    console.error("getAbiFromExplorer 异常:", err);
    process.exit(1);
  }
  if (!abi) {
    console.error("获取 ABI 失败（返回 null），上方应已打印失败原因");
    console.log("\n使用已知 deposit(uint256) ABI 做本地 decode 测试...");
    abi = [
      {
        type: "function",
        name: "deposit",
        inputs: [{ name: "amount", type: "uint256" }],
      },
    ] as object[];
  } else {
    console.log("ABI 获取成功，共", abi.length, "个条目");
  }

  const decoded = decodeInput(abi, INPUT);
  if (decoded) {
    console.log("解码结果:", formatDecodedInput(decoded));
    console.log("详情:", JSON.stringify(decoded, null, 2));
  } else {
    console.error("解码失败");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
