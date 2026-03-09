/**
 * ERC20 Transfer 事件解析
 * Transfer(address indexed from, address indexed to, uint256 value)
 * topic0: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface TransferParams {
  from: string;
  to: string;
  value: bigint;
  token: string;
  decimals?: number;
}

/**
 * 从 log 解析 ERC20 Transfer 参数
 */
export function parseTransferFromLog(log: {
  address: string;
  topics: string[];
  data: string;
}): TransferParams | null {
  if (!log.topics?.[0] || log.topics[0].toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) {
    return null;
  }
  const from = log.topics[1] ? "0x" + log.topics[1].slice(-40) : "";
  const to = log.topics[2] ? "0x" + log.topics[2].slice(-40) : "";
  const value = BigInt(log.data && log.data !== "0x" ? log.data : "0");
  return { from, to, value, token: log.address };
}

/**
 * 从 internal call input 解析 transfer(address,uint256) 参数
 * 0xa9059cbb + to(32) + value(32)
 */
export function parseTransferFromInput(
  input: string,
  fromAddress: string,
  tokenAddress: string
): TransferParams | null {
  const sig = "0xa9059cbb";
  if (!input?.startsWith(sig) && !input?.toLowerCase().startsWith(sig)) {
    return null;
  }
  const hex = input.startsWith("0x") ? input.slice(2) : input;
  const sigHex = sig.startsWith("0x") ? sig.slice(2) : sig;
  if (hex.length < sigHex.length + 128) return null;
  const args = hex.slice(sigHex.length);
  const to = "0x" + args.slice(24, 64).toLowerCase();
  const value = BigInt("0x" + args.slice(64, 128));
  return { from: fromAddress, to, value, token: tokenAddress };
}

/**
 * 格式化 value 为可读字符串（默认 18 位小数）
 */
export function formatTransferValue(value: bigint, decimals = 18): string {
  const divisor = BigInt(10 ** decimals);
  const intPart = value / divisor;
  const fracPart = value % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${intPart}.${fracStr}` : `${intPart}`;
}
