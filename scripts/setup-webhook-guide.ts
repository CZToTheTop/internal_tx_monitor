#!/usr/bin/env node
/**
 * 输出 Alchemy Dashboard 手动创建 Webhook 所需的配置
 * 运行: npm run setup:guide
 */
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { buildGraphQLQuery, buildMergedQuery } from "../src/graphql.js";

function main() {
  const config = process.env.CONFIG_PATH ? loadConfig(process.env.CONFIG_PATH) : loadConfig();

  if (!config.webhookUrl) {
    console.error("config.yaml 中 webhookUrl 为空，请先配置");
    process.exit(1);
  }

  const url = config.webhookUrl.endsWith("/webhook") ? config.webhookUrl : `${config.webhookUrl}/webhook`;

  console.log(`
========================================
Alchemy Webhook 手动配置指南
========================================

【步骤 1】启动本地服务 + 隧道
  - 终端1: npm run monitor
  - 终端2: cloudflared tunnel --url http://localhost:8080
  - 将隧道输出的 URL 加上 /webhook 填入 config.yaml

【步骤 2】打开 Alchemy Dashboard
  https://dashboard.alchemy.com/
  → 选择你的 App
  → 左侧 Data → Webhooks
  → 点击 Create Webhook

【步骤 3】选择 Custom Webhook，填写以下内容：

  Network: ${config.network}
  Webhook URL: ${url}

  GraphQL Query（请整体复制到 Dashboard，仅一条）:
`);

  if (config.singleWebhook) {
    console.log(buildMergedQuery(config));
  } else {
    for (let i = 0; i < config.targets.length; i++) {
      const target = config.targets[i]!;
      if (target.type === "events" || target.type === "internal_calls" || target.type === "transactions") {
        if (i > 0) console.log("");
        console.log(`  # 以下为 target ${i + 1}/${config.targets.length}: ${target.label ?? target.type}`);
        console.log(buildGraphQLQuery(target));
      }
    }
  }

  console.log(`
【步骤 4】创建 Webhook 后
  - 单 Webhook 模式: 将 Signing Key 填入 config 的 targets.signing_key
  - 多 Webhook 模式: 将每个 Signing Key 填入对应 target 的 signing_key 或 .env 的 SIGNING_KEYS
  - 重启 npm run monitor

【步骤 5】测试
  - 点击 Alchemy Dashboard 的 Test Webhook
  - 或运行: npm run test:webhook
========================================
`);
}

main();
