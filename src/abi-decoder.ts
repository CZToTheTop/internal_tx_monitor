/**
 * 获取 to 合约 ABI 并 decode internal call 的 input
 * 支持：config 内联 ABI、abiPath 文件、Etherscan API 拉取
 * Proxy 检测：通过 eth_getStorageAt 读取 EIP-1967 Implementation slot，有值则拉取 implementation 的 ABI
 * 代理：设置 HTTPS_PROXY 或 HTTP_PROXY 环境变量后，请求会走代理
 */

import { Interface, type InterfaceAbi } from "ethers";
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { getRpcUrl } from "./trace-api.js";

const V2_BASE = "https://api.etherscan.io/v2/api";

/** EIP-1967 proxy implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation') - 1)) */
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const RPC_FALLBACK: Record<string, string | string[]> = {
  BNB_MAINNET: [
    "https://bsc-dataseed.binance.org",
    "https://bsc.publicnode.com",
    "https://bsc-dataseed1.defibit.io",
  ],
  BNB_TESTNET: "https://bsc-testnet.publicnode.com",
  ETH_MAINNET: "https://eth.llamarpc.com",
  ETH_SEPOLIA: "https://rpc.sepolia.org",
  MATIC_MAINNET: "https://polygon-rpc.com",
  ARB_MAINNET: "https://arb1.arbitrum.io/rpc",
  OP_MAINNET: "https://mainnet.optimism.io",
  BASE_MAINNET: "https://mainnet.base.org",
};

const NETWORK_TO_CHAINID: Record<string, number> = {
  ETH_MAINNET: 1,
  ETH_SEPOLIA: 11155111,
  BNB_MAINNET: 56,
  BNB_TESTNET: 97,
  MATIC_MAINNET: 137,
  MATIC_AMOY: 80002,
  ARB_MAINNET: 42161,
  ARB_SEPOLIA: 421614,
  OP_MAINNET: 10,
  OP_SEPOLIA: 11155420,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
};

const abiCache = new Map<string, string>(); // address:network -> json string

function getCacheDir(): string {
  return resolve(process.cwd(), ".abi-cache");
}

function getCacheFilePath(address: string, network: string): string {
  const safeAddr = address.replace(/^0x/i, "").toLowerCase();
  const safeNet = network.replace(/[^a-zA-Z0-9_-]/g, "_");
  return resolve(getCacheDir(), `${safeAddr}_${safeNet}.json`);
}

function loadFromDisk(address: string, network: string): object[] | null {
  try {
    const fp = getCacheFilePath(address, network);
    if (!existsSync(fp)) return null;
    const raw = readFileSync(fp, "utf-8");
    const abi = JSON.parse(raw) as object[];
    return Array.isArray(abi) ? abi : null;
  } catch {
    return null;
  }
}

function saveToDisk(address: string, network: string, abiJson: string): void {
  try {
    const dir = getCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fp = getCacheFilePath(address, network);
    writeFileSync(fp, abiJson, "utf-8");
  } catch {
    // 忽略写入失败
  }
}

function buildGetAbiUrl(address: string, chainId: number, apiKey: string): string {
  const params = new URLSearchParams({
    chainid: String(chainId),
    module: "contract",
    action: "getabi",
    address,
    apikey: apiKey,
  });
  return `${V2_BASE}?${params}`;
}

const FETCH_TIMEOUT_MS = 30000;

const proxyAgent = new EnvHttpProxyAgent();

async function fetchWithTimeout(
  url: string,
  options?: Record<string, unknown>,
  useProxy = true
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetchOpts = {
      ...options,
      signal: ctrl.signal,
      ...(useProxy && { dispatcher: proxyAgent }),
    };
    const res = await undiciFetch(url, fetchOpts);
    return res as unknown as Response;
  } finally {
    clearTimeout(t);
  }
}

async function ethGetStorageAt(rpcUrl: string, address: string): Promise<string | null> {
  const res = await fetchWithTimeout(
    rpcUrl,
    {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getStorageAt",
      params: [address, EIP1967_IMPL_SLOT, "latest"],
    }),
  },
    false
  );
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) return null;
  const raw = json.result;
  if (!raw || typeof raw !== "string" || raw === "0x" || raw === "0x0") return null;
  const hex = raw.replace(/^0x/i, "").padStart(64, "0");
  if (hex === "0".repeat(64)) return null;
  const addr = "0x" + hex.slice(-40).toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(addr) ? addr : null;
}

/** 通过 eth_getStorageAt 读取 EIP-1967 Implementation slot，返回 implementation 地址或 null */
async function getImplementationFromStorage(
  address: string,
  rpcUrl: string,
  network: string
): Promise<string | null> {
  try {
    let impl: string | null = null;
    try {
      impl = await ethGetStorageAt(rpcUrl, address);
    } catch {
      // 主 RPC 失败时尝试 fallback
    }
    if (!impl && RPC_FALLBACK[network]) {
      const fallbacks = Array.isArray(RPC_FALLBACK[network])
        ? RPC_FALLBACK[network]
        : [RPC_FALLBACK[network]];
      for (const url of fallbacks) {
        try {
          impl = await ethGetStorageAt(url, address);
          if (impl) break;
        } catch {
          // 继续尝试下一个
        }
      }
    }
    return impl;
  } catch (err) {
    console.error(
      `[abi-decoder] eth_getStorageAt 请求异常 address=${address}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** 从 Etherscan V2 拉取 ABI（内部，不读缓存） */
async function fetchAbiFromApi(
  address: string,
  chainId: number,
  apiKey: string
): Promise<object[] | null> {
  const url = buildGetAbiUrl(address, chainId, apiKey);
  try {
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as {
      status?: string;
      message?: string;
      result?: string;
    };
    if (json.status !== "1" || typeof json.result !== "string") {
      const msg = [json.message, typeof json.result === "string" ? json.result : JSON.stringify(json.result)].filter(Boolean).join(" ");
      console.error(
        `[abi-decoder] getabi 失败 address=${address} chainId=${chainId}:`,
        msg || res.status
      );
      return null;
    }
    return JSON.parse(json.result) as object[];
  } catch (err) {
    console.error(
      `[abi-decoder] getabi 请求异常 address=${address} chainId=${chainId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** 从 Etherscan API V2 获取合约 ABI（优先内存缓存 → 磁盘缓存 → API）
 * 支持 proxy：若为 proxy 合约，会拉取 implementation 的 ABI 用于 decode */
export async function getAbiFromExplorer(
  address: string,
  network: string
): Promise<object[] | null> {
  const cacheKey = `${address.toLowerCase()}:${network}`;

  const fromMemory = abiCache.get(cacheKey);
  if (fromMemory) {
    try {
      return JSON.parse(fromMemory) as object[];
    } catch {
      return null;
    }
  }

  const fromDisk = loadFromDisk(address, network);
  if (fromDisk) {
    abiCache.set(cacheKey, JSON.stringify(fromDisk));
    return fromDisk;
  }

  const chainId = NETWORK_TO_CHAINID[network];
  if (chainId == null) return null;

  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error("[abi-decoder] 未配置 ETHERSCAN_API_KEY");
    return null;
  }

  try {
    const rpcUrl = getRpcUrl(network);
    let effectiveAddr = address;
    if (rpcUrl) {
      const implAddr = await getImplementationFromStorage(address, rpcUrl, network);
      if (implAddr) effectiveAddr = implAddr;
    }

    let abi = await fetchAbiFromApi(effectiveAddr, chainId, apiKey);
    if (!abi?.length && effectiveAddr !== address) {
      abi = await fetchAbiFromApi(address, chainId, apiKey);
    }
    if (!abi?.length) {
      console.error(`[abi-decoder] 无法获取 ABI address=${address} network=${network}`);
      return null;
    }

    const abiJson = JSON.stringify(abi);
    abiCache.set(cacheKey, abiJson);
    saveToDisk(address, network, abiJson);
    return abi;
  } catch (err) {
    console.error(
      `[abi-decoder] getAbiFromExplorer 异常 address=${address} network=${network}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** 从文件加载 ABI（支持 JSON 数组或 { abi: [...] } 格式） */
export function loadAbiFromFile(path: string): object[] | null {
  try {
    const base = process.cwd();
    const fullPath = resolve(base, path);
    if (!fullPath.startsWith(base)) return null;
    const raw = readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed?.abi && Array.isArray(parsed.abi)) return parsed.abi;
    return null;
  } catch {
    return null;
  }
}

export type DecodedInput = {
  name: string;
  args: Record<string, unknown>;
};

/** 用 ABI 解码 calldata，返回 functionName 和参数对象 */
export function decodeInput(abi: object[], input: string): DecodedInput | null {
  if (!input || input === "0x" || input.length < 10) return null;
  try {
    const iface = new Interface(abi as InterfaceAbi);
    const decoded = iface.parseTransaction({ data: input });
    if (!decoded) return null;
    const args: Record<string, unknown> = {};
    decoded.fragment.inputs.forEach((param, i) => {
      const v = decoded.args[i];
      args[param.name] = v !== undefined ? (typeof v === "bigint" ? v.toString() : v) : undefined;
    });
    return { name: decoded.name, args };
  } catch {
    return null;
  }
}

/** 将 DecodedInput 格式化为可读字符串 */
export function formatDecodedInput(d: DecodedInput): string {
  const parts = Object.entries(d.args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${d.name}(${parts.join(", ")})`;
}

/** 解码事件 log：topics[0]=selector, topics[1..]=indexed, data=non-indexed；返回事件名与参数数组（按 ABI 顺序） */
export function decodeLog(
  abi: object[],
  topics: string[],
  data: string
): { name: string; args: unknown[] } | null {
  if (!topics?.length || !topics[0]) return null;
  try {
    const iface = new Interface(abi as InterfaceAbi);
    const parsed = iface.parseLog({ topics: topics as string[], data: data ?? "0x" });
    if (!parsed) return null;
    const args: unknown[] = [];
    parsed.fragment.inputs.forEach((_param, i) => {
      const v = parsed.args[i];
      args.push(v !== undefined ? (typeof v === "bigint" ? v.toString() : v) : undefined);
    });
    return { name: parsed.name, args };
  } catch {
    return null;
  }
}
