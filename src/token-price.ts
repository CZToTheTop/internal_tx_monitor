/**
 * ERC20 美元计价：链上 decimals + CoinGecko simple/token_price（按合约地址）。
 * 无法取价时返回 null（视为 unknown token）。
 */

import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { fetch } from "undici";
import { getRpcUrl } from "./trace-api.js";

const COINGECKO_PLATFORM: Record<string, string> = {
  ETH_MAINNET: "ethereum",
  ETH_SEPOLIA: "ethereum",
  BNB_MAINNET: "binance-smart-chain",
  BNB_TESTNET: "binance-smart-chain",
  MATIC_MAINNET: "polygon-pos",
  MATIC_AMOY: "polygon-pos",
  ARB_MAINNET: "arbitrum-one",
  ARB_SEPOLIA: "arbitrum-one",
  OP_MAINNET: "optimistic-ethereum",
  OP_SEPOLIA: "optimistic-ethereum",
  BASE_MAINNET: "base",
  BASE_SEPOLIA: "base",
};

const priceCache = new Map<string, { expires: number; usd: number | null }>();
const decimalsCache = new Map<string, { expires: number; decimals: number | null }>();
const CACHE_MS = 60_000;

function cacheKey(network: string, token: string): string {
  return `${network}:${token.toLowerCase()}`;
}

export function coingeckoPlatformId(network: string): string | null {
  return COINGECKO_PLATFORM[network] ?? null;
}

export async function getErc20Decimals(
  network: string,
  tokenAddress: string
): Promise<number | null> {
  const rpc = getRpcUrl(network);
  if (!rpc) return null;
  const key = `dec:${cacheKey(network, tokenAddress)}`;
  const hit = decimalsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.decimals;

  let decimals: number | null = null;
  try {
    const provider = new JsonRpcProvider(rpc);
    const c = new Contract(
      tokenAddress,
      ["function decimals() view returns (uint8)"],
      provider
    );
    const d = await c.decimals();
    decimals = Number(d);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 255) decimals = null;
  } catch {
    decimals = null;
  }

  decimalsCache.set(key, { expires: Date.now() + CACHE_MS, decimals });
  return decimals;
}

/**
 * 返回合约 token 相对 USD 的单价（非 wei）。无法报价时返回 null。
 */
export async function fetchErc20UsdPrice(
  network: string,
  tokenAddress: string
): Promise<number | null> {
  const platform = coingeckoPlatformId(network);
  if (!platform) return null;

  const addr = tokenAddress.toLowerCase();
  const key = `usd:${cacheKey(network, tokenAddress)}`;
  const hit = priceCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.usd;

  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  const base = apiKey
    ? "https://pro-api.coingecko.com/api/v3/simple/token_price"
    : "https://api.coingecko.com/api/v3/simple/token_price";
  const url = `${base}/${platform}?contract_addresses=${addr}&vs_currencies=usd`;

  let usd: number | null = null;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) headers["x-cg-pro-api-key"] = apiKey;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[token-price] CoinGecko HTTP ${res.status} for ${addr}`);
      usd = null;
    } else {
      const data = (await res.json()) as Record<string, { usd?: number }>;
      const row = data[addr] ?? data[tokenAddress] ?? data[tokenAddress.toLowerCase()];
      const v = row?.usd;
      usd = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
  } catch (e) {
    console.warn("[token-price] CoinGecko fetch failed:", (e as Error)?.message ?? e);
    usd = null;
  }

  priceCache.set(key, { expires: Date.now() + CACHE_MS, usd });
  return usd;
}

/**
 * 计算本次转账的美元名义金额；任一步失败返回 null（视为无法估价）。
 */
export async function erc20TransferUsdValue(
  network: string,
  tokenAddress: string,
  amountRaw: bigint
): Promise<number | null> {
  const [decimals, priceUsd] = await Promise.all([
    getErc20Decimals(network, tokenAddress),
    fetchErc20UsdPrice(network, tokenAddress),
  ]);
  if (decimals == null || priceUsd == null) return null;
  try {
    const human = parseFloat(formatUnits(amountRaw, decimals));
    if (!Number.isFinite(human)) return null;
    return human * priceUsd;
  } catch {
    return null;
  }
}
