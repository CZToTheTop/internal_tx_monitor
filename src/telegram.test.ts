import { describe, it, expect, vi } from "vitest";
import { getExplorerBase, resolveTelegramCredentials } from "./telegram.js";

describe("resolveTelegramCredentials", () => {
  it("uses default env when channel omitted", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok-def");
    vi.stubEnv("TELEGRAM_CHAT_ID", "chat-def");
    expect(resolveTelegramCredentials()).toEqual({ token: "tok-def", chatId: "chat-def" });
    vi.unstubAllEnvs();
  });

  it("prefers literal botToken and chatId on channel", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "ignored");
    vi.stubEnv("TELEGRAM_CHAT_ID", "ignored");
    expect(
      resolveTelegramCredentials({
        botToken: "tok-lit",
        chatId: "chat-lit",
      })
    ).toEqual({ token: "tok-lit", chatId: "chat-lit" });
    vi.unstubAllEnvs();
  });

  it("uses custom env names from channel", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "wrong");
    vi.stubEnv("MY_TG_TOKEN", "tok-a");
    vi.stubEnv("MY_TG_CHAT", "-100");
    expect(
      resolveTelegramCredentials({
        botTokenEnv: "MY_TG_TOKEN",
        chatIdEnv: "MY_TG_CHAT",
      })
    ).toEqual({ token: "tok-a", chatId: "-100" });
    vi.unstubAllEnvs();
  });
});

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
