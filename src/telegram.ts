/**
 * Telegram Bot 通知
 * 默认需设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID；
 * 或在 Config.alerts.telegram 中覆盖（字面量或自定义环境变量名）。
 */

import type { TelegramAlertChannel } from "./config.js";

const TG_API = "https://api.telegram.org";

const DEFAULT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const DEFAULT_CHAT_ENV = "TELEGRAM_CHAT_ID";

/** 解析发送所用的 token / chat_id（便于测试与排查） */
export function resolveTelegramCredentials(channel?: TelegramAlertChannel): {
  token: string | undefined;
  chatId: string | undefined;
} {
  if (!channel) {
    return {
      token: process.env[DEFAULT_TOKEN_ENV],
      chatId: process.env[DEFAULT_CHAT_ENV],
    };
  }
  const token =
    (typeof channel.botToken === "string" && channel.botToken.trim() !== ""
      ? channel.botToken.trim()
      : undefined) ?? process.env[channel.botTokenEnv?.trim() || DEFAULT_TOKEN_ENV];
  const chatId =
    (typeof channel.chatId === "string" && channel.chatId.trim() !== ""
      ? channel.chatId.trim()
      : undefined) ?? process.env[channel.chatIdEnv?.trim() || DEFAULT_CHAT_ENV];
  return { token, chatId };
}

/** 发送文本到 Telegram；`channel` 来自当前 Config.alerts.telegram，缺省则用全局环境变量 */
export async function sendTelegram(text: string, channel?: TelegramAlertChannel): Promise<boolean> {
  const { token, chatId } = resolveTelegramCredentials(channel);
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error("[telegram] 发送失败:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] 请求异常:", err);
    return false;
  }
}

/** 根据 network 获取区块浏览器 base URL */
export function getExplorerBase(network: string): string {
  const m: Record<string, string> = {
    ETH_MAINNET: "https://etherscan.io",
    ETH_SEPOLIA: "https://sepolia.etherscan.io",
    BNB_MAINNET: "https://bscscan.com",
    BNB_TESTNET: "https://testnet.bscscan.com",
    MATIC_MAINNET: "https://polygonscan.com",
    ARB_MAINNET: "https://arbiscan.io",
    OP_MAINNET: "https://optimistic.etherscan.io",
    BASE_MAINNET: "https://basescan.org",
  };
  return m[network] ?? "https://etherscan.io";
}
