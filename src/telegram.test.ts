import { describe, it, expect } from "vitest";
import { getExplorerBase } from "./telegram.js";

describe("getExplorerBase", () => {
  it("returns bscscan for BNB_MAINNET", () => {
    expect(getExplorerBase("BNB_MAINNET")).toBe("https://bscscan.com");
  });
  it("returns etherscan for ETH_MAINNET", () => {
    expect(getExplorerBase("ETH_MAINNET")).toBe("https://etherscan.io");
  });
  it("returns default for unknown", () => {
    expect(getExplorerBase("UNKNOWN")).toBe("https://etherscan.io");
  });
});
