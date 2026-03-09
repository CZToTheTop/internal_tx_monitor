/**
 * Telegram Bot 通知
 * 需设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID
 */

const TG_API = "https://api.telegram.org";

/** 发送文本到 Telegram */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
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
