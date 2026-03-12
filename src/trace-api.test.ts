import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRpcUrl, getTraceToTxMap } from "./trace-api.js";

describe("getRpcUrl", () => {
  let origRpc: string | undefined;
  let origKey: string | undefined;

  beforeEach(() => {
    origRpc = process.env.RPC_URL;
    origKey = process.env.ALCHEMY_API_KEY;
  });
  afterEach(() => {
    process.env.RPC_URL = origRpc;
    process.env.ALCHEMY_API_KEY = origKey;
  });

  it("returns RPC_URL when set", () => {
    process.env.RPC_URL = "https://rpc.example.com";
    process.env.ALCHEMY_API_KEY = "";
    expect(getRpcUrl()).toBe("https://rpc.example.com");
  });
  it("derives from ALCHEMY_API_KEY + network", () => {
    process.env.RPC_URL = "";
    process.env.ALCHEMY_API_KEY = "key123";
    expect(getRpcUrl("BNB_MAINNET")).toBe("https://bnb-mainnet.g.alchemy.com/v2/key123");
  });
  it("returns empty when neither set", () => {
    process.env.RPC_URL = "";
    process.env.ALCHEMY_API_KEY = "";
    expect(getRpcUrl("ETH_MAINNET")).toBe("");
  });
});

describe("getTraceToTxMap", () => {
  it("returns empty for empty traces", async () => {
    const map = await getTraceToTxMap("https://x.com", 1, []);
    expect(map.size).toBe(0);
  });
});
