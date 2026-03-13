import { describe, it, expect } from "vitest";
import {
  decodeInput,
  formatDecodedInput,
  loadAbiFromFile,
  getAbiFromExplorer,
} from "./abi-decoder.js";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
];

describe("decodeInput", () => {
  it("decodes transfer(address,uint256) calldata", () => {
    // transfer(0x1234...5678, 1000) - selector 0xa9059cbb
    const input =
      "0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890" +
      "00000000000000000000000000000000000000000000000000000000000003e8";
    const r = decodeInput(ERC20_TRANSFER_ABI, input);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("transfer");
    expect(r!.args.to).toBe("0x1234567890123456789012345678901234567890");
    expect(r!.args.amount).toBe("1000");
  });

  it("returns null for empty or invalid input", () => {
    expect(decodeInput(ERC20_TRANSFER_ABI, "")).toBeNull();
    expect(decodeInput(ERC20_TRANSFER_ABI, "0x")).toBeNull();
    expect(decodeInput(ERC20_TRANSFER_ABI, "0x12")).toBeNull();
  });

  it("returns null when selector not in ABI", () => {
    const input = "0xdeadbeef" + "0".repeat(128);
    expect(decodeInput(ERC20_TRANSFER_ABI, input)).toBeNull();
  });
});

describe("formatDecodedInput", () => {
  it("formats decoded params", () => {
    const d = {
      name: "transfer",
      args: { to: "0xabc", amount: "1000" },
    };
    expect(formatDecodedInput(d)).toBe("transfer(to=0xabc, amount=1000)");
  });
});

describe("loadAbiFromFile", () => {
  it("loads array ABI from file", () => {
    const r = loadAbiFromFile("test-fixtures/erc20-abi.json");
    expect(r).not.toBeNull();
    expect(Array.isArray(r)).toBe(true);
    expect(r![0]).toMatchObject({ type: "function", name: "transfer" });
  });
  it("returns null for non-JSON or missing file", () => {
    expect(loadAbiFromFile("nonexistent.json")).toBeNull();
  });
  it("loads from { abi: [...] } format", () => {
    const r = loadAbiFromFile("test-fixtures/contract-abi-wrap.json");
    expect(r).not.toBeNull();
    expect(r![0]).toMatchObject({ type: "function", name: "approve" });
  });
});

describe("getAbiFromExplorer", () => {
  it("returns null for unsupported network", async () => {
    const r = await getAbiFromExplorer("0x123", "UNKNOWN");
    expect(r).toBeNull();
  });

  it("returns null when no ETHERSCAN_API_KEY", async () => {
    const orig = process.env.ETHERSCAN_API_KEY;
    delete process.env.ETHERSCAN_API_KEY;
    const r = await getAbiFromExplorer("0xdAC17F958D2ee523a2206206994597C13D831ec7", "ETH_MAINNET");
    if (orig !== undefined) process.env.ETHERSCAN_API_KEY = orig;
    expect(r).toBeNull();
  });
});
