#!/usr/bin/env node
/**
 * 不向链上发交易：构造一笔「看起来像 Venus Core Pool Comptroller 内部调用」的 mock webhook，
 * 用于本地验证 config.venus.yaml + Telegram（须先 npm run monitor）。
 *
 * 用法:
 *   npm run test:venus:mock
 *   CONFIG_PATH=config.venus.yaml npm run test:venus:mock
 *
 * 环境变量:
 *   SIGNING_KEY — 与 Alchemy Webhook / .env 一致（yaml 里 signing_key 为空时用此项验签）
 *   MOCK_SELECTOR — 可选，默认 Comptroller `setPriceOracle(address)` = 0x530e784f
 *   MOCK_FROM — 可选，trace.from（任意 EOA）
 */
import "dotenv/config";
import { createHmac } from "crypto";
import http from "http";
import { loadConfig } from "../src/config.js";

const COMPTROLLER_BNB =
  process.env.VENUS_COMPTROLLER ?? "0xfD36E2c2a6789Db23113685031d7F16329158384";

/** setPriceOracle(address) — config.venus.yaml 已列出 */
const DEFAULT_SELECTOR = "0x530e784f";

function padAddress(addr: string): string {
  const hex = addr.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  return hex.slice(-64);
}

async function main(): Promise<void> {
  const configPath = process.env.CONFIG_PATH?.trim() || "config.venus.yaml";
  const config = loadConfig(configPath);

  const sel = (process.env.MOCK_SELECTOR ?? DEFAULT_SELECTOR).toLowerCase().replace(/^0x/, "");
  const selector = "0x" + sel.slice(0, 8).padEnd(8, "0");
  const oraclePlaceholder = process.env.MOCK_ORACLE ?? "0x0000000000000000000000000000000000000001";
  const input = (selector + padAddress(oraclePlaceholder)).toLowerCase();

  const mockFrom =
    process.env.MOCK_FROM ?? "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3"; // BSC: arbitrary common hot wallet pattern / placeholder

  const txHash =
    process.env.MOCK_TX_HASH ??
    "0x" +
      createHmac("sha256", "venus-mock-" + Date.now())
        .update(input)
        .digest("hex");

  const blockNum = parseInt(process.env.MOCK_BLOCK ?? "38000000", 10);

  const trace = {
    from: { address: mockFrom },
    to: { address: COMPTROLLER_BNB },
    input,
  };

  const payload = JSON.stringify({
    id: "mock-venus-" + Date.now(),
    webhookId: "wh_mock_venus",
    type: "GRAPHQL",
    createdAt: new Date().toISOString(),
    event: {
      data: {
        block: {
          number: blockNum,
          hash: "0x" + "ab".repeat(32),
          timestamp: new Date().toISOString(),
          logs: [],
          transactions: [{ hash: txHash }],
          callTracerTraces: [trace],
        },
      },
    },
  });

  const signingKey =
    process.env.SIGNING_KEY ??
    process.env.SIGNING_KEYS?.split(",")[0]?.trim() ??
    config.singleWebhookSigningKey ??
    config.webhookGroups?.[0]?.signingKey;

  if (!signingKey?.trim()) {
    console.error(
      "请设置 SIGNING_KEY（与部署 monitor 时相同）。config 里 signing_key 为空时验签依赖此项。"
    );
    process.exit(1);
  }

  const sig = createHmac("sha256", signingKey.trim()).update(payload, "utf8").digest("hex");

  const port = process.env.PORT ?? "8080";
  console.log(`Config: ${config.configPath ?? configPath}`);
  console.log(`Mock trace → to=${COMPTROLLER_BNB} selector=${selector}`);
  console.log(`Posting http://127.0.0.1:${port}/webhook ...`);

  await new Promise<void>((resolve, reject) => {
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
          if (res.statusCode === 200) console.log("✅ 若 Telegram 已配置，应收到 Comptroller 相关告警");
          else console.log("❌ 检查 monitor 是否启动、SIGNING_KEY 是否与验签一致");
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
