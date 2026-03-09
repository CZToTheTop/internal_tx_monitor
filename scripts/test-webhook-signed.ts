#!/usr/bin/env node
/**
 * 本机测试 webhook（带正确签名）
 * 用法: npm run test:webhook:local
 * 使用 http 模块直连，绕过系统代理
 */
import "dotenv/config";
import { createHmac } from "crypto";
import http from "http";

const PORT = process.env.PORT ?? "8080";

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

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: PORT,
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
      console.log(`HTTP ${res.statusCode}: ${body.slice(0, 100)}`);
      console.log(res.statusCode === 200 ? "✅ 通过" : "❌ 失败");
    });
  }
);
req.on("error", (e) => {
  console.error("请求失败:", e.message);
  console.log("请确认 npm run monitor 已启动");
});
req.write(payload);
req.end();
