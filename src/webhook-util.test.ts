import { describe, it, expect } from "vitest";
import {
  isValidSignature,
  getGroupForSignature,
  getTargetForSignature,
  resolveWebhookDispatch,
} from "./webhook-util.js";
import { createHmac } from "crypto";
import type { Config } from "./config.js";

describe("isValidSignature", () => {
  const body = '{"id":"x","event":{}}';
  const key = "whsec_test123";

  it("accepts valid signature", () => {
    const sig = createHmac("sha256", key).update(body, "utf8").digest("hex");
    expect(isValidSignature(body, sig, key)).toBe(true);
  });
  it("rejects invalid signature", () => {
    expect(isValidSignature(body, "00".repeat(32), key)).toBe(false);
  });
  it("rejects wrong length signature", () => {
    expect(isValidSignature(body, "ab", key)).toBe(false);
  });
});

describe("getGroupForSignature", () => {
  const config: Config = {
    network: "ETH_MAINNET",
    targets: [],
    webhookUrl: "",
    webhookGroups: [
      { signingKey: "whsec_a", targets: [{ type: "internal_calls", addresses: [], label: "A" }] },
      { signingKey: "whsec_b", targets: [{ type: "internal_calls", addresses: [], label: "B" }] },
    ],
  };
  const body = '{"id":"x"}';

  it("returns group for matching key", () => {
    const sig = createHmac("sha256", "whsec_a").update(body, "utf8").digest("hex");
    const g = getGroupForSignature(config, body, sig);
    expect(g).not.toBeNull();
    expect(g!.signingKey).toBe("whsec_a");
    expect(g!.targets[0]!.label).toBe("A");
  });
  it("returns null for no match", () => {
    const sig = createHmac("sha256", "whsec_other").update(body, "utf8").digest("hex");
    const g = getGroupForSignature(config, body, sig);
    expect(g).toBeNull();
  });
});

describe("getTargetForSignature", () => {
  const config: Config = {
    network: "ETH_MAINNET",
    targets: [
      { type: "events", addresses: [], signing_key: "whsec_t1", label: "T1" },
    ],
    webhookUrl: "",
  };
  const body = '{"id":"x"}';

  it("returns target for matching key", () => {
    const sig = createHmac("sha256", "whsec_t1").update(body, "utf8").digest("hex");
    const t = getTargetForSignature(config, body, sig);
    expect(t).not.toBeNull();
    expect(t!.label).toBe("T1");
  });
});

describe("resolveWebhookDispatch", () => {
  const body = '{"id":"x"}';

  it("picks second config when first does not match", () => {
    const c1: Config = {
      network: "ETH_MAINNET",
      targets: [],
      webhookUrl: "",
      webhookGroups: [{ signingKey: "whsec_only1", targets: [{ type: "events", addresses: ["0x1"], label: "X" }] }],
    };
    const c2: Config = {
      network: "ETH_MAINNET",
      targets: [],
      webhookUrl: "",
      webhookGroups: [{ signingKey: "whsec_only2", targets: [{ type: "events", addresses: ["0x2"], label: "Y" }] }],
    };
    const sig = createHmac("sha256", "whsec_only2").update(body, "utf8").digest("hex");
    const d = resolveWebhookDispatch([c1, c2], body, sig, []);
    expect(d).not.toBeNull();
    expect(d!.config).toBe(c2);
    expect(d!.matchedGroup?.signingKey).toBe("whsec_only2");
  });

  it("uses env key only when single config", () => {
    const c: Config = {
      network: "ETH_MAINNET",
      targets: [{ type: "events", addresses: [], label: "Z" }],
      webhookUrl: "",
    };
    const sig = createHmac("sha256", "whsec_env").update(body, "utf8").digest("hex");
    expect(resolveWebhookDispatch([c], body, sig, ["whsec_env"])).not.toBeNull();
    expect(resolveWebhookDispatch([c, c], body, sig, ["whsec_env"])).toBeNull();
  });
});
