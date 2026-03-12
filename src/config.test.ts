import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config.js";

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

  it("throws when network missing", () => {
    const path = join(TMP, "bad.yaml");
    mkdirSync(TMP, { recursive: true });
    writeFileSync(path, "webhookUrl: x\ntargets: []");
    expect(() => loadConfig(path)).toThrow("network");
    rmSync(TMP, { recursive: true, force: true });
  });
});
