#!/usr/bin/env node
/**
 * 根据 config.yaml 自动创建 Alchemy Webhooks
 * 运行: npm run setup
 *
 * 需要环境变量:
 *   ALCHEMY_AUTH_TOKEN - Alchemy Dashboard 顶部的 Auth Token
 *   (可选) CONFIG_PATH / CONFIG_PATHS - 单文件或多文件（逗号或换行分隔），默认 config.yaml
 */
import "dotenv/config";
import { loadConfigsFromEnv, type Config } from "./config.js";
import { buildGraphQLQuery, buildMergedQuery } from "./graphql.js";
import { createWebhook } from "./alchemy-api.js";

const authToken = process.env.ALCHEMY_AUTH_TOKEN;
if (!authToken) {
  console.error("请设置环境变量 ALCHEMY_AUTH_TOKEN（在 Alchemy Dashboard 顶部获取）");
  process.exit(1);
}
const token: string = authToken;

async function runOneConfig(config: Config, fileLabel: string): Promise<string[]> {
  const signingKeys: string[] = [];

  if (!config.webhookUrl) {
    console.error(`${fileLabel}: 缺少 webhookUrl，跳过`);
    return signingKeys;
  }

  console.log(`\n======== ${fileLabel} ========`);
  console.log(`网络: ${config.network}`);
  console.log(`Webhook URL: ${config.webhookUrl}`);
  const groups = config.webhookGroups;
  if (groups?.length) {
    console.log(`模式: 多组（${groups.length} 个 signing_key 组）`);
    console.log(`共 ${config.targets.length} 条规则\n`);
  } else {
    console.log(`监控目标: ${config.targets.length} 个`);
    if (config.singleWebhook) {
      console.log("模式: 单 Webhook（整份 config 共用一个）\n");
    } else {
      console.log("");
    }
  }

  if (groups?.length) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const name = `monitor_${fileLabel}_group_${i + 1}_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      console.log(`创建 Webhook 组 [${i + 1}/${groups.length}]（${group.targets.length} 条规则）`);
      try {
        const query = buildMergedQuery({ ...config, targets: group.targets });
        const { id, signingKey } = await createWebhook(token, {
          network: config.network,
          webhookUrl: config.webhookUrl,
          graphqlQuery: query,
          name,
        });
        console.log(`  ✅ 已创建: ${id}`);
        if (signingKey) {
          signingKeys.push(signingKey);
          console.log(`  Signing Key: ${signingKey.slice(0, 12)}... → 填到该文件第 ${i + 1} 个 group 的 signing_key`);
        }
      } catch (err) {
        console.error("  ❌ 失败:", err);
      }
      console.log("");
    }
  } else if (config.singleWebhook) {
    const name = `monitor_${fileLabel}_merged_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    console.log("创建 1 个合并 Webhook");
    try {
      const query = buildMergedQuery(config);
      const { id, signingKey } = await createWebhook(token, {
        network: config.network,
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
      console.error("  ❌ 失败:", err);
    }
  } else {
    for (let i = 0; i < config.targets.length; i++) {
      const target = config.targets[i]!;
      const label = target.label ?? `${target.type}_${i}`;
      const name = `monitor_${fileLabel}_${label}_${Date.now()}`.replace(/\s+/g, "_");

      const query = buildGraphQLQuery(target);
      const network = target.network ?? config.network;
      console.log(`创建 Webhook [${i + 1}/${config.targets.length}]: ${label}`);
      console.log(`  网络: ${network}  类型: ${target.type}`);
      console.log(`  地址: ${target.addresses?.slice(0, 2).join(", ")}${(target.addresses?.length ?? 0) > 2 ? "..." : ""}`);

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
  }

  return signingKeys;
}

async function main(): Promise<void> {
  const configs = loadConfigsFromEnv();
  const allKeys: string[] = [];

  for (const config of configs) {
    const label = config.configPath ?? "config";
    const keys = await runOneConfig(config, label);
    allKeys.push(...keys);
  }

  if (allKeys.length) {
    console.log("---");
    console.log("请将各 Webhook 的 Signing Key 填回对应 yaml 的 signing_key / group（多文件时按文件名区分）");
    console.log("或 .env: SIGNING_KEYS=" + allKeys.join(","));
    console.log("");
    console.log("然后运行: npm run monitor");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
