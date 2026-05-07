#!/usr/bin/env node
/**
 * 本地发一条测试 Telegram 告警，验证 token / chat 与（可选）config 里 alerts.telegram
 * 用法:
 *   npm run test:alert
 *   CONFIG_PATH=config.venus.yaml npm run test:alert
 */
import "dotenv/config";
import type { Config } from "../src/config.js";
import { loadConfigsFromEnv } from "../src/config.js";
import { sendTelegram } from "../src/telegram.js";

let configs: Config[] = [];
try {
  configs = loadConfigsFromEnv();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn(`[test:alert] 加载 yaml 失败（将仅用环境变量 TELEGRAM_*）: ${msg}`);
}

const pathLabel =
  configs.length > 0 ? configs.map((c) => c.configPath ?? "?").join(", ") : "(no yaml)";
const first = configs[0];
const channel = first?.alerts?.telegram;

const text =
  `🔔 <b>Test alert</b> (local)\n` +
  `Config: <code>${pathLabel}</code>\n` +
  (channel ? `Using yaml <code>alerts.telegram</code>\n` : `Using env <code>TELEGRAM_*</code>\n`);

const ok = await sendTelegram(text, channel);
if (ok) {
  console.log("✅ 已发送测试消息到 Telegram");
} else {
  console.error(
    "❌ 发送失败：请设置 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID，或在当前 yaml 配置 alerts.telegram（或 *_env 指向的环境变量）"
  );
  process.exit(1);
}
