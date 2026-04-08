import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetch } from "undici";

vi.mock("undici", async (importOriginal) => {
  const mod = await importOriginal<typeof import("undici")>();
  return { ...mod, fetch: vi.fn() };
});

import { fetchErc20UsdPrice, coingeckoPlatformId } from "./token-price.js";

describe("token-price", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it("coingeckoPlatformId maps BNB_MAINNET", () => {
    expect(coingeckoPlatformId("BNB_MAINNET")).toBe("binance-smart-chain");
  });

  it("fetchErc20UsdPrice parses CoinGecko response", async () => {
    const addr = "0x55d398326f99059ff775485246999027b3197955".toLowerCase();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ [addr]: { usd: 1.0 } }),
    } as Awaited<ReturnType<typeof fetch>>);

    const p = await fetchErc20UsdPrice("BNB_MAINNET", addr);
    expect(p).toBe(1.0);
  });

  it("fetchErc20UsdPrice returns null on empty body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Awaited<ReturnType<typeof fetch>>);

    const p = await fetchErc20UsdPrice(
      "BNB_MAINNET",
      "0x0000000000000000000000000000000000000001"
    );
    expect(p).toBeNull();
  });
});
