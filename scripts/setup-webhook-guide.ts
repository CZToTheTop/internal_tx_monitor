#!/usr/bin/env node
/**
 * 输出 Alchemy Dashboard 手动创建 Webhook 所需的配置
 * 运行: npm run setup:guide
 */
import "dotenv/config";
import { loadConfigsFromEnv } from "../src/config.js";
import { buildGraphQLQuery, buildMergedQuery } from "../src/graphql.js";

function main() {
  const configs = loadConfigsFromEnv();
  if (!configs.length) {
    console.error("未加载到任何配置");
    process.exit(1);
  }
  const anyUrl = configs.some((c) => c.webhookUrl);
  if (!anyUrl) {
    console.error("所有 yaml 中 webhookUrl 均为空，请先配置");
    process.exit(1);
  }

  console.log(`
========================================
Alchemy Webhook 手动配置指南
========================================

【步骤 1】启动本地服务 + 隧道
  - 终端1: npm run monitor
  - 终端2: cloudflared tunnel --url http://localhost:8080
  - 将隧道输出的 URL 加上 /webhook 填入各 yaml 的 webhookUrl

【步骤 2】打开 Alchemy Dashboard
  https://dashboard.alchemy.com/
  → 选择你的 App
  → 左侧 Data → Webhooks
  → 点击 Create Webhook

【步骤 3】选择 Custom Webhook；多份 yaml 则每个项目重复创建一次 Webhook。

`);

  for (let fi = 0; fi < configs.length; fi++) {
    const config = configs[fi]!;
    if (!config.webhookUrl) {
      console.error(`跳过（无 webhookUrl）: ${config.configPath ?? fi}`);
      continue;
    }
    const url = config.webhookUrl.endsWith("/webhook") ? config.webhookUrl : `${config.webhookUrl}/webhook`;

    console.log(`
---------- 文件: ${config.configPath ?? "config.yaml"} ----------
  Network: ${config.network}
  Webhook URL: ${url}

  GraphQL Query:
`);

    if (config.webhookGroups?.length) {
      for (let i = 0; i < config.webhookGroups.length; i++) {
        const group = config.webhookGroups[i]!;
        if (i > 0) console.log("");
        console.log(`  # 组 ${i + 1}/${config.webhookGroups.length}（${group.targets.length} 条规则）`);
        console.log(buildMergedQuery({ ...config, targets: group.targets }));
      }
    } else if (config.singleWebhook) {
      console.log("  # 单 Webhook 合并查询:");
      console.log(buildMergedQuery(config));
    } else {
      for (let i = 0; i < config.targets.length; i++) {
        const target = config.targets[i]!;
        if (target.type === "events" || target.type === "internal_calls" || target.type === "transactions") {
          if (i > 0) console.log("");
          console.log(`  # target ${i + 1}/${config.targets.length}: ${target.label ?? target.type}`);
          console.log(buildGraphQLQuery(target));
        }
      }
    }
  }

  console.log(`
【步骤 4】创建 Webhook 后
  - 将 Signing Key 填回对应 yaml 的 signing_key / group
  - 重启 npm run monitor

【步骤 5】测试
  - 点击 Alchemy Dashboard 的 Test Webhook
  - 或运行: npm run test:webhook
========================================
`);
}

main();
