import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRpcUrl, getTraceToTxMap } from "./trace-api.js";

describe("getRpcUrl", () => {
  let origBnb: string | undefined;
  let origEth: string | undefined;
  let origKey: string | undefined;

  beforeEach(() => {
    origBnb = process.env.BNB_RPC;
    origEth = process.env.ETH_RPC;
    origKey = process.env.ALCHEMY_API_KEY;
  });
  afterEach(() => {
    process.env.BNB_RPC = origBnb;
    process.env.ETH_RPC = origEth;
    process.env.ALCHEMY_API_KEY = origKey;
  });

  it("returns base + ALCHEMY_API_KEY when no custom RPC", () => {
    delete process.env.BNB_RPC;
    process.env.ALCHEMY_API_KEY = "key123";
    expect(getRpcUrl("BNB_MAINNET")).toBe("https://bnb-mainnet.g.alchemy.com/v2/key123");
  });
  it("returns custom full URL when BNB_RPC set without trailing slash", () => {
    process.env.BNB_RPC = "https://bnb.example.com/v2/abc";
    expect(getRpcUrl("BNB_MAINNET")).toBe("https://bnb.example.com/v2/abc");
  });
  it("returns empty when no key and no custom RPC", () => {
    delete process.env.ETH_RPC;
    delete process.env.ALCHEMY_API_KEY;
    expect(getRpcUrl("ETH_MAINNET")).toBe("");
  });
  it("returns empty when network unknown", () => {
    expect(getRpcUrl("UNKNOWN")).toBe("");
  });
});

describe("getTraceToTxMap", () => {
  it("returns empty for empty traces", async () => {
    const map = await getTraceToTxMap("https://x.com", 1, []);
    expect(map.size).toBe(0);
  });
});
