import { describe, it, expect } from "vitest";
import { collectAbiPrefetchJobs } from "./abi-prefetch.js";
import type { Config } from "./config.js";

describe("collectAbiPrefetchJobs", () => {
  it("skips events without rules", () => {
    const config: Config = {
      network: "ETH_MAINNET",
      webhookUrl: "",
      targets: [
        {
          type: "events",
          addresses: ["0x1111111111111111111111111111111111111111"],
          label: "e",
        },
      ],
    };
    expect(collectAbiPrefetchJobs(config)).toEqual([]);
  });

  it("includes events with rules when no local abi", () => {
    const config: Config = {
      network: "ETH_MAINNET",
      webhookUrl: "",
      targets: [
        {
          type: "events",
          addresses: ["0x1111111111111111111111111111111111111111"],
          label: "e",
          rules: [{ when: { event: "Transfer(address,address,uint256)" } }],
        },
      ],
    };
    const j = collectAbiPrefetchJobs(config);
    expect(j).toHaveLength(1);
    expect(j[0]!.address).toBe("0x1111111111111111111111111111111111111111");
    expect(j[0]!.network).toBe("ETH_MAINNET");
  });

  it("includes internal_calls to addresses when no local abi", () => {
    const config: Config = {
      network: "BNB_MAINNET",
      webhookUrl: "",
      targets: [
        {
          type: "internal_calls",
          addresses: ["0x2222222222222222222222222222222222222222"],
          fromAddresses: ["0x3333333333333333333333333333333333333333"],
          label: "i",
        },
      ],
    };
    const j = collectAbiPrefetchJobs(config);
    expect(j.some((x) => x.address === "0x2222222222222222222222222222222222222222")).toBe(true);
  });

  it("dedupes same address across targets", () => {
    const config: Config = {
      network: "ETH_MAINNET",
      webhookUrl: "",
      targets: [
        {
          type: "events",
          addresses: ["0x1111111111111111111111111111111111111111"],
          label: "a",
          rules: [{ when: { event: "X()" } }],
        },
        {
          type: "events",
          addresses: ["0x1111111111111111111111111111111111111111"],
          label: "b",
          rules: [{ when: { event: "Y()" } }],
        },
      ],
    };
    expect(collectAbiPrefetchJobs(config)).toHaveLength(1);
  });
});
