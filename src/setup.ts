#!/usr/bin/env node
/**
 * 根据 config.yaml 自动创建 Alchemy Webhooks
 * 运行: npm run setup
 *
 * 需要环境变量:
 *   ALCHEMY_AUTH_TOKEN - Alchemy Dashboard 顶部的 Auth Token
 *   (可选) CONFIG_PATH - 配置文件路径，默认 config.yaml
 */
import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildGraphQLQuery } from "./graphql.js";
import { createWebhook } from "./alchemy-api.js";

const authToken = process.env.ALCHEMY_AUTH_TOKEN;
if (!authToken) {
  console.error("请设置环境变量 ALCHEMY_AUTH_TOKEN（在 Alchemy Dashboard 顶部获取）");
  process.exit(1);
}
const token: string = authToken;

async function main(): Promise<void> {
  const config = process.env.CONFIG_PATH
    ? loadConfig(process.env.CONFIG_PATH)
    : loadConfig();

  if (!config.webhookUrl) {
    console.error("config.yaml 必须包含 webhookUrl（用于 Webhook 模式）");
    process.exit(1);
  }
  console.log(`网络: ${config.network}`);
  console.log(`Webhook URL: ${config.webhookUrl}`);
  console.log(`监控目标: ${config.targets.length} 个\n`);

  const signingKeys: string[] = [];

  for (let i = 0; i < config.targets.length; i++) {
    const target = config.targets[i]!;
    const label = target.label ?? `${target.type}_${i}`;
    const name = `monitor_${label}_${Date.now()}`.replace(/\s+/g, "_");

    const query = buildGraphQLQuery(target);
    const network = target.network ?? config.network;
    console.log(`创建 Webhook [${i + 1}/${config.targets.length}]: ${label}`);
    console.log(`  网络: ${network}  类型: ${target.type}`);
    console.log(`  地址: ${target.addresses.slice(0, 2).join(", ")}${target.addresses.length > 2 ? "..." : ""}`);

    try {
      const { id, signingKey } = await createWebhook(token, {
        network,
        webhookUrl: config.webhookUrl,
        graphqlQuery: query,
        name,
      });
      console.log(`  ✅ 已创建: ${id}`);
      if (signingKey) {
        signingKeys.push(signingKey);
        console.log(`  Signing Key: ${signingKey.slice(0, 12)}...`);
      }
    } catch (err) {
      console.error(`  ❌ 失败:`, err);
    }
    console.log("");
  }

  if (signingKeys.length) {
    console.log("---");
    console.log("请将每个 Webhook 的 Signing Key 填入 config.yaml 对应 target 的 signing_key（推荐），");
    console.log("或填入 .env: SIGNING_KEYS=" + signingKeys.join(","));
    console.log("");
    console.log("然后运行: npm run monitor");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
