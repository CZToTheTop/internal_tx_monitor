/**
 * 启动前根据 config 预取并缓存合约 ABI（Explorer API），避免运行中才暴露缺 key / 未验证合约等问题。
 * 跳过条件：target 已配置内联 `abi` 或可用的 `abiPath`。
 */

import type { Config, MonitorTarget } from "./config.js";
import { getAbiFromExplorer, loadAbiFromFile } from "./abi-decoder.js";

function targetHasLocalAbi(t: MonitorTarget): boolean {
  if (t.abi && t.abi.length > 0) return true;
  if (t.abiPath) {
    const fromFile = loadAbiFromFile(t.abiPath);
    if (fromFile?.length) return true;
  }
  return false;
}

export type AbiPrefetchJob = {
  address: string;
  network: string;
  /** 便于日志：来自哪类 target、label */
  reason: string;
};

/**
 * 收集需要从 Explorer 拉取的 (address, network)（去重）。
 * - events：配置了 `rules` 且未提供本地 ABI 时，预取 `addresses` 上合约（用于 log 解码）。
 * - internal_calls：未提供本地 ABI 时，预取 `toAddresses ?? addresses`（与运行时 trace.to 匹配集合一致）。
 */
export function collectAbiPrefetchJobs(config: Config): AbiPrefetchJob[] {
  const seen = new Set<string>();
  const out: AbiPrefetchJob[] = [];

  const push = (address: string | undefined, network: string, reason: string) => {
    if (!address || typeof address !== "string") return;
    const a = address.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(a)) return;
    const key = `${a}:${network}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ address: a, network, reason });
  };

  for (const t of config.targets) {
    const network = t.network ?? config.network;

    if (t.type === "events") {
      if (!t.rules?.length) continue;
      if (targetHasLocalAbi(t)) continue;
      for (const addr of t.addresses ?? []) {
        push(addr, network, `events label=${t.label ?? "-"}`);
      }
    }

    if (t.type === "internal_calls") {
      if (targetHasLocalAbi(t)) continue;
      const toSide = t.toAddresses?.length ? t.toAddresses : t.addresses;
      for (const addr of toSide ?? []) {
        push(addr, network, `internal_calls label=${t.label ?? "-"}`);
      }
    }
  }

  return out;
}

export type AbiPrefetchResult = {
  ok: { address: string; network: string }[];
  failed: { address: string; network: string; error: string }[];
};

/**
 * 对所有配置合并任务并顺序预取（减轻 Explorer 限流）。
 */
export async function prefetchAbisForConfigs(configs: Config[]): Promise<AbiPrefetchResult> {
  const seen = new Set<string>();
  const jobs: AbiPrefetchJob[] = [];
  for (const c of configs) {
    for (const j of collectAbiPrefetchJobs(c)) {
      const key = `${j.address}:${j.network}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(j);
    }
  }

  const ok: { address: string; network: string }[] = [];
  const failed: { address: string; network: string; error: string }[] = [];

  if (jobs.length === 0) {
    return { ok, failed };
  }

  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    for (const j of jobs) {
      failed.push({
        address: j.address,
        network: j.network,
        error: "ETHERSCAN_API_KEY is not set (required to prefetch / fetch ABI)",
      });
    }
    return { ok, failed };
  }

  console.log(`[abi-prefetch] ${jobs.length} contract ABI(s) to resolve (Explorer + .abi-cache)`);

  for (const j of jobs) {
    try {
      const abi = await getAbiFromExplorer(j.address, j.network);
      if (abi?.length) {
        ok.push({ address: j.address, network: j.network });
        console.log(`[abi-prefetch] OK ${j.address} ${j.network} (${j.reason})`);
      } else {
        const err = "Explorer returned empty ABI or unsupported network";
        failed.push({ address: j.address, network: j.network, error: err });
        console.error(`[abi-prefetch] FAIL ${j.address} ${j.network} (${j.reason}): ${err}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ address: j.address, network: j.network, error: msg });
      console.error(`[abi-prefetch] FAIL ${j.address} ${j.network} (${j.reason}): ${msg}`);
    }
  }

  return { ok, failed };
}
