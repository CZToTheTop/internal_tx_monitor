import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig, loadConfigs, mergeConfigsForPoll, resolveConfigPathsFromEnv } from "./config.js";

const TMP = join(process.cwd(), "tmp-test-config");

describe("loadConfig", () => {
  it("loads single-webhook config", () => {
    mkdirSync(TMP, { recursive: true });
    const path = join(TMP, "single.yaml");
    writeFileSync(
      path,
      `
network: bsc_mainnet
webhookUrl: https://x.com
targets:
  signing_key: whsec_x
  list:
    - type: internal_calls
      addresses: []
      label: L1
`
    );
    const c = loadConfig(path);
    expect(c.network).toBe("BNB_MAINNET");
    expect(c.configPath).toContain("single.yaml");
    expect(c.singleWebhookSigningKey).toBe("whsec_x");
    expect(c.targets).toHaveLength(1);
    expect(c.targets[0]!.label).toBe("L1");
    rmSync(TMP, { recursive: true, force: true });
  });

  it("loads webhookGroups config", () => {
    const path = join(TMP, "groups.yaml");
    mkdirSync(TMP, { recursive: true });
    writeFileSync(
      path,
      `
network: eth_mainnet
webhookUrl: https://x.com
targets:
  - signing_key: whsec_a
    list:
      - type: events
        addresses: ["0xaaa"]
        label: A
  - signing_key: whsec_b
    list:
      - type: transactions
        addresses: []
        txFrom: ["0xb"]
        label: B
`
    );
    const c = loadConfig(path);
    expect(c.network).toBe("ETH_MAINNET");
    expect(c.webhookGroups).toHaveLength(2);
    expect(c.webhookGroups![0]!.signingKey).toBe("whsec_a");
    expect(c.webhookGroups![1]!.targets[0]!.label).toBe("B");
    rmSync(TMP, { recursive: true, force: true });
  });

  it("loadConfigs merges two files independently", () => {
    mkdirSync(TMP, { recursive: true });
    const a = join(TMP, "proj-a.yaml");
    const b = join(TMP, "proj-b.yaml");
    const minimal = (label: string) =>
      `network: bsc_mainnet\nwebhookUrl: https://x.com\ntargets:\n  signing_key: whsec_x\n  list:\n    - type: events\n      addresses: ["0x0000000000000000000000000000000000000001"]\n      label: ${label}\n`;
    writeFileSync(a, minimal("A"));
    writeFileSync(b, minimal("B"));
    const configs = loadConfigs([a, b]);
    expect(configs).toHaveLength(2);
    expect(configs[0]!.targets[0]!.label).toBe("A");
    expect(configs[1]!.targets[0]!.label).toBe("B");
    const merged = mergeConfigsForPoll(configs);
    expect(merged.targets).toHaveLength(2);
    rmSync(TMP, { recursive: true, force: true });
  });

  it("resolveConfigPathsFromEnv splits CONFIG_PATHS", () => {
    vi.stubEnv("CONFIG_PATHS", "a.yaml, b.yaml");
    vi.stubEnv("CONFIG_PATH", "");
    expect(resolveConfigPathsFromEnv()).toEqual(["a.yaml", "b.yaml"]);
    vi.unstubAllEnvs();
  });

  it("throws when network missing", () => {
    const path = join(TMP, "bad.yaml");
    mkdirSync(TMP, { recursive: true });
    writeFileSync(path, "webhookUrl: x\ntargets: []");
    expect(() => loadConfig(path)).toThrow("network");
    rmSync(TMP, { recursive: true, force: true });
  });
});
