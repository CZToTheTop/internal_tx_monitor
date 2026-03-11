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
import { buildGraphQLQuery, buildMergedQuery } from "./graphql.js";
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
  const groups = config.webhookGroups;
  if (groups?.length) {
    console.log(`模式: 多组（${groups.length} 个 signing_key 组，每组多条规则，先按 key 分流再组内匹配）`);
    console.log(`共 ${config.targets.length} 条规则\n`);
  } else {
    console.log(`监控目标: ${config.targets.length} 个`);
    if (config.singleWebhook) {
      console.log("模式: 单 Webhook（整份 config 共用一个，服务端按 target 多维度筛查）\n");
    } else {
      console.log("");
    }
  }

  const signingKeys: string[] = [];

  if (groups?.length) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const name = `monitor_group_${i + 1}_${Date.now()}`;
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
          console.log(`  Signing Key: ${signingKey.slice(0, 12)}... → 填到 config 第 ${i + 1} 个 group 的 signing_key`);
        }
      } catch (err) {
        console.error("  ❌ 失败:", err);
      }
      console.log("");
    }
  } else if (config.singleWebhook) {
    const name = `monitor_merged_${Date.now()}`;
    console.log("创建 1 个合并 Webhook（覆盖所有 target 的过滤条件）");
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
      const name = `monitor_${label}_${Date.now()}`.replace(/\s+/g, "_");

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

  if (signingKeys.length) {
    console.log("---");
    if (groups?.length) {
      console.log("请将上述每个 Signing Key 按顺序填入 config 中对应 group 的 signing_key（第 1 个 key → 第 1 个 group）");
    } else if (config.singleWebhook) {
      console.log("请将上述 Signing Key 填入 config 的 targets.signing_key（单 Webhook 模式）");
    } else {
      console.log("请将每个 Webhook 的 Signing Key 填入 config.yaml 对应 target 的 signing_key（推荐），");
      console.log("或填入 .env: SIGNING_KEYS=" + signingKeys.join(","));
    }
    console.log("");
    console.log("然后运行: npm run monitor");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
