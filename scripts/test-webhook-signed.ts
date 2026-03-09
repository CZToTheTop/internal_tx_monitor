#!/usr/bin/env node
/**
 * 本机测试 webhook（带正确签名）
 * 用法: npm run test:webhook:local
 */
import "dotenv/config";
import { createHmac } from "crypto";

const PORT = process.env.PORT ?? "8080";
const URL = `http://127.0.0.1:${PORT}`;

const payload = JSON.stringify({
  id: "test-local",
  webhookId: "wh_test",
  type: "GRAPHQL",
  event: { data: { block: { number: 12345 } } },
});

const signingKey = process.env.SIGNING_KEY ?? process.env.SIGNING_KEYS?.split(",")[0];
if (!signingKey) {
  console.error("请设置 .env 中的 SIGNING_KEY");
  process.exit(1);
}

const sig = createHmac("sha256", signingKey).update(payload, "utf8").digest("hex");

const res = await fetch(URL + "/webhook", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Alchemy-Signature": sig,
  },
  body: payload,
  // @ts-ignore
  duplex: "half",
});

const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
console.log(res.ok ? "✅ 通过" : "❌ 失败");
