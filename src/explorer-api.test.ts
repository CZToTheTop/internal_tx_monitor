import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTraceToTxMapFromExplorer } from "./explorer-api.js";

describe("getTraceToTxMapFromExplorer", () => {
  let origKey: string | undefined;
  beforeEach(() => {
    origKey = process.env.ETHERSCAN_API_KEY;
    process.env.ETHERSCAN_API_KEY = "testkey";
  });
  afterEach(() => {
    process.env.ETHERSCAN_API_KEY = origKey;
  });

  it("returns empty for empty traces", async () => {
    const map = await getTraceToTxMapFromExplorer("ETH_MAINNET", 1, []);
    expect(map.size).toBe(0);
  });

  it("returns empty for unsupported network", async () => {
    const map = await getTraceToTxMapFromExplorer("UNKNOWN", 1, [
      { from: { address: "0xa" }, to: { address: "0xb" }, input: "0x" },
    ]);
    expect(map.size).toBe(0);
  });
});
